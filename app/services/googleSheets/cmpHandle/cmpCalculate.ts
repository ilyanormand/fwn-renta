import MiddlewareTest from "./middlewareCmpCalculate";
import {
  calculateCMP,
  getInventoryBySku,
  getInventoryBySkuBatch,
} from "./utilsCmp";

export type InvoiceItem = {
  invoice_sku: string;
  qty: number;
  unit_price: number;
};

export type ProcessingResult = {
  processed: number;
  updated: number;
  skipped: number;
  notFound: string[];
  errors: string[];
  calculatedCmp: Record<string, number>; // { "ICE-LEMON": 4.28, "ICE-PEACH": 5.1 }
};

interface ItemRowData {
  item: InvoiceItem;
  foundRow: any[];
  rowIndex: number;
  skuFwn: string;
  oldCmp: number | null;
  currentKValue: number | null;
}
// [
//   { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
//   { invoice_sku: "ICE-PEACH", qty: 50, unit_price: 3.5 },
// ];

export async function updateCmpInSheets(
  invoiceItems: InvoiceItem[],
  sheetsService: any,
  totalShippingFee: number = 0,
  admin?: any,
  progressCallback?: (
    current: number,
    total: number,
    sku?: string
  ) => Promise<void>
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

  if (totalShippingFee > 0) {
    invoiceItems = MiddlewareTest.calculatePriceUnitWithShipping(
      invoiceItems,
      totalShippingFee
    );
  }

  // Step 1: Prepare all data - find rows and collect SKUs
  // Use index as key to handle duplicate SKUs with different prices
  const itemRowDataMap = new Map<number, ItemRowData>();
  const skuFwnList: string[] = [];

  for (let index = 0; index < invoiceItems.length; index++) {
    const item = invoiceItems[index];
    result.processed++;
    const normalizedInvoiceSku = MiddlewareTest.normalizeSku(item.invoice_sku);

    // Find the line with all the data
    // Search in column E (row[3]) which contains Invoice SKUs
    // foundRow = ["FWN-001", "Ice Lemon", "Brand A", "ICE-LEMON, ICE-LEM", "10.5", "4.28", ...]
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

    const skuFwn = String(foundRow[0] || "").trim();
    const oldCmp = foundRow[5] ? Number(foundRow[5]) : null;
    const currentKValue = foundRow[9] ? Number(foundRow[9]) : null;
    const rowIndex = sheetData.values.indexOf(foundRow) + 2; // +2 because we start from B2

    // Use index as key to preserve duplicate SKUs with different prices
    itemRowDataMap.set(index, {
      item,
      foundRow,
      rowIndex,
      skuFwn,
      oldCmp,
      currentKValue,
    });

    if (!skuFwnList.includes(skuFwn)) {
      skuFwnList.push(skuFwn);
    }
  }

  // Step 2: Batch fetch all inventory quantities from Shopify (one request instead of N)
  let inventoryMap: Record<string, number> = {};
  if (admin && skuFwnList.length > 0) {
    try {
      inventoryMap = await getInventoryBySkuBatch(admin, skuFwnList);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch inventory fetch failed: ${errorMsg}`);
    }
  }

  const batchUpdates: Array<{
    range: string;
    values: Array<Array<string | number | boolean>>;
  }> = [];

  let processedCount = 0;
  for (const [index, rowData] of itemRowDataMap.entries()) {
    try {
      const oldStockSku = inventoryMap[rowData.skuFwn] ?? 0;
      const newCmp = calculateCMP(
        oldStockSku,
        rowData.oldCmp,
        rowData.item.qty,
        rowData.item.unit_price
      );

      result.calculatedCmp[rowData.item.invoice_sku] = newCmp;

      const rangeToUpdate = `Sheet1!G${rowData.rowIndex}:L${rowData.rowIndex}`;
      batchUpdates.push({
        range: rangeToUpdate,
        values: [
          [
            newCmp, // G - (new CMP)
            oldStockSku, // H - (quantite ancien)
            rowData.item.qty, // I - (nouveau quantit)
            rowData.currentKValue || "", // J - (unit price)
            rowData.item.unit_price, // K - (new unit price)
            totalShippingFee, // L - (total shipping fee)
          ],
        ],
      });

      console.log(
        `✅ Prepared update for row ${rowData.rowIndex} (${rowData.skuFwn}): CMP ${rowData.oldCmp} → ${newCmp}`
      );

      // Update progress if callback provided
      processedCount++;
      if (progressCallback) {
        await progressCallback(
          processedCount,
          itemRowDataMap.size,
          rowData.skuFwn
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`${rowData.item.invoice_sku}: ${errorMsg}`);
      console.error(
        `❌ Error preparing update for ${rowData.item.invoice_sku}:`,
        errorMsg
      );
    }
  }

  if (batchUpdates.length > 0) {
    try {
      const updateResult = await sheetsService.batchUpdate(
        spreadsheetId,
        batchUpdates
      );

      if (updateResult.success) {
        result.updated = batchUpdates.length;
      } else {
        result.errors.push(`Batch update failed: ${updateResult.message}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch update error: ${errorMsg}`);
    }
  }

  return result;
}

//Old function
export async function updateCmpInSheets2(
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
  for (const item of invoiceItems) {
    result.processed++;
    const normalizedInvoiceSku = MiddlewareTest.normalizeSku(item.invoice_sku);
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
      const skuFwn = String(foundRow[0] || "").trim();
      const oldCmp = foundRow[5] ? Number(foundRow[5]) : null;
      const oldStockSku = await getInventoryBySku(admin, skuFwn);
      const currentKValue = foundRow[9] ? Number(foundRow[9]) : null;

      const newCmp = calculateCMP(
        oldStockSku,
        oldCmp,
        item.qty,
        item.unit_price
      );

      result.calculatedCmp[item.invoice_sku] = newCmp;
      const rowIndex = sheetData.values.indexOf(foundRow) + 2;

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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`${item.invoice_sku}: ${errorMsg}`);
    }
  }

  return result;
}
