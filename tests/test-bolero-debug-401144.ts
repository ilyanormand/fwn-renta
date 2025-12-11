import { parseInvoiceFromPdf } from "../app/services/pdfParsing.server";
import { join } from "path";

async function main() {
  const pdfPath = join(
    process.cwd(),
    "python",
    "test_invoices",
    "Bolero",
    "i_inv401144.pdf"
  );
  console.log(`Testing Bolero parser with: ${pdfPath}`);

  try {
    const result = await parseInvoiceFromPdf(pdfPath, "Bolero", false);
    if (result.success && result.data) {
      console.log("Parsed Items:");
      result.data.lineItems.forEach((item, index) => {
        console.log(`Item ${index + 1}:`);
        console.log(`  Description: ${item.description}`);
        console.log(`  Code: ${item.supplierSku}`);
        console.log(`  Qty: ${item.quantity}`);
        console.log(`  Price: ${item.unitPrice}`);
        console.log(`  Total: ${item.total}`);
      });
      console.log(`\nShipping Fee: ${result.data.invoiceMetadata.shippingFee}`);
      console.log(`Total Invoice Amount: ${result.data.invoiceMetadata.total}`);
    } else {
      console.error("Parsing failed:", result.error);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
