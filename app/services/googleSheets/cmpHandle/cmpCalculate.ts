import MiddlewareTest from "./middlewareCmpCalculate";
import { calculateCMP, getInventoryBySku } from "./utilsCmp";

export type InvoiceItem = {
  invoice_sku: string;
  qty: number;
  unit_price: number; // unit_price already includes shipping cost after calculatePriceUnitWithShipping
};

export type ProcessingResult = {
  processed: number;
  updated: number;
  skipped: number;
  notFound: string[];
  errors: string[];
  calculatedCmp: Record<string, number>; // { "ICE-LEMON": 4.28, "ICE-PEACH": 5.1 }
};

// [
//   { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
//   { invoice_sku: "ICE-PEACH", qty: 50, unit_price: 3.5 },
// ];
export async function updateCmpInSheets(
  invoiceItems: InvoiceItem[],
  sheetsService: any,
  totalShippingFee: number = 0,
  admin?: any
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    notFound: [],
    errors: [],
    calculatedCmp: {},
  };

  //ID of the spreadsheet
  const spreadsheetId = await MiddlewareTest.getSheetsId();
  const range = "Sheet1!B2:L";
  const sheetData = await sheetsService.readData(spreadsheetId, range);
  if (!sheetData || !sheetData.values) {
    console.error("No data from Google Sheets");
    result.errors.push("No data from Google Sheets");
    return result;
  }
  // Add shipping cost to each item (unit_price will include shipping)
  // Example:
  // Input:  [{ invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 }]
  // Output: [{ invoice_sku: "ICE-LEMON", qty: 100, unit_price: 5.2 }]
  // (3.2 + (300 / 150) = 5.2)
  if (totalShippingFee > 0) {
    invoiceItems = MiddlewareTest.calculatePriceUnitWithShipping(
      invoiceItems,
      totalShippingFee
    );
  }
  // Handle each item from the invoice
  for (const item of invoiceItems) {
    result.processed++;
    const normalizedInvoiceSku = MiddlewareTest.normalizeSku(item.invoice_sku);
    // Find the line with all the data
    // Search in column E (row[3]) which contains Invoice SKUs
    const foundRow = sheetData.values.find((row: any[]) => {
      const invoiceSkusCell = String(row[3] || "").trim();
      const skusInCell = invoiceSkusCell
        .split(/[,;\/|]/)
        .map((sku) => MiddlewareTest.normalizeSku(sku));

      return skusInCell.includes(normalizedInvoiceSku);
    });
    if (!foundRow) {
      console.log(`SKU ${normalizedInvoiceSku} not found in sheets`);
      result.notFound.push(item.invoice_sku);
      result.skipped++;
      continue;
    }

    try {
      // Now we have the whole line with the data
      const skuFwn = String(foundRow[0] || "").trim();
      const oldCmp = foundRow[5] ? Number(foundRow[5]) : null;
      const oldStockSku = await getInventoryBySku(admin, skuFwn);

      // Read current value from column K (For make old unit price)
      const currentKValue = foundRow[9] ? Number(foundRow[9]) : null;

      const newCmp = calculateCMP(
        oldStockSku,
        oldCmp,
        item.qty,
        item.unit_price
      );

      result.calculatedCmp[item.invoice_sku] = newCmp;
      const rowIndex = sheetData.values.indexOf(foundRow) + 2; // +2 because we start from B2

      const rangeToUpdate = `Sheet1!G${rowIndex}:L${rowIndex}`;
      await sheetsService.updateData(spreadsheetId, rangeToUpdate, [
        [
          newCmp, // G - (new CMP)
          oldStockSku, // H - (quantite ancien)
          item.qty, // I - (nouveau quantit)
          currentKValue || "", // J - (unit price)
          item.unit_price, // K - (new unit price)
          totalShippingFee, // L - (total shipping fee)
        ],
      ]);

      result.updated++;
      console.log(
        `✅ Updated row ${rowIndex} for ${skuFwn}: CMP ${oldCmp} → ${newCmp}`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`${item.invoice_sku}: ${errorMsg}`);
      console.error(`❌ Error updating ${item.invoice_sku}:`, errorMsg);
    }
  }

  return result;
}
