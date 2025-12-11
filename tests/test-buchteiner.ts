import { parseInvoiceFromPdf } from "../app/services/pdfParsing.server";
import { join } from "path";

async function testBuchteinerParser() {
  console.log("🧪 Testing Buchteiner PDF Parser");
  console.log("================================");

  const pdfPath = join(process.cwd(), "samples", "Buchteiner.pdf");
  const supplierName = "Buchteiner";

  try {
    console.log(`📄 Parsing PDF: ${pdfPath}`);
    console.log(`🏢 Supplier: ${supplierName}`);
    console.log("");

    const result = await parseInvoiceFromPdf(pdfPath, supplierName, true);

    if (result.success && result.data) {
      console.log("✅ Parsing successful!");
      console.log("");

      // Display vendor information
      console.log("🏢 Vendor Information:");
      console.log(`   Name: ${result.data.supplierInfo.name || "N/A"}`);
      console.log(`   Address: ${result.data.supplierInfo.address || "N/A"}`);
      console.log(
        `   VAT Number: ${result.data.supplierInfo.vatNumber || "N/A"}`
      );
      console.log("");

      // Display customer information
      console.log("👤 Customer Information:");
      console.log(`   Name: ${result.data.customer?.name || "N/A"}`);
      console.log("");

      // Display invoice metadata
      console.log("📋 Invoice Metadata:");
      console.log(
        `   Invoice Number: ${result.data.invoiceMetadata.invoiceNumber || "N/A"}`
      );
      console.log(
        `   Invoice Date: ${result.data.invoiceMetadata.invoiceDate || "N/A"}`
      );
      console.log(
        `   Currency: ${result.data.invoiceMetadata.currency || "N/A"}`
      );
      console.log(
        `   Subtotal: ${result.data.invoiceMetadata.subtotal || "N/A"}`
      );
      console.log(
        `   Shipping Fee: ${result.data.invoiceMetadata.shippingFee || "N/A"}`
      );
      console.log(`   Total: ${result.data.invoiceMetadata.total || "N/A"}`);
      console.log("");

      // Display line items
      console.log("📦 Line Items:");
      console.log(`   Total Items: ${result.data.lineItems.length}`);
      console.log("");

      result.data.lineItems.forEach((item, index) => {
        console.log(`   Item ${index + 1}:`);
        console.log(`     SKU: ${item.supplierSku}`);
        console.log(
          `     Description: ${item.description.substring(0, 100)}${item.description.length > 100 ? "..." : ""}`
        );
        console.log(`     Quantity: ${item.quantity}`);
        console.log(`     Unit Price: ${item.unitPrice}`);
        console.log(`     Total: ${item.total}`);
        console.log("");
      });

      // Verify expected values
      console.log("🔍 Verification:");
      const expectedSku = "1331S";
      const expectedQty = 990;
      const expectedUnitPrice = 0.795;
      const expectedTotal = 787.05;
      const expectedShippingFee = 356.0;

      const foundItem = result.data.lineItems.find(
        (item) => item.supplierSku === expectedSku
      );

      if (foundItem) {
        console.log(`   ✅ Found expected SKU: ${expectedSku}`);
        console.log(
          `   ✅ Quantity: ${foundItem.quantity} (expected: ${expectedQty})`
        );
        console.log(
          `   ✅ Unit Price: ${foundItem.unitPrice} (expected: ${expectedUnitPrice})`
        );
        console.log(
          `   ✅ Total: ${foundItem.total} (expected: ${expectedTotal})`
        );

        // Check if values match exactly
        const qtyMatch = foundItem.quantity === expectedQty;
        const priceMatch =
          Math.abs(foundItem.unitPrice - expectedUnitPrice) < 0.001;
        const totalMatch = Math.abs(foundItem.total - expectedTotal) < 0.01;

        if (qtyMatch && priceMatch && totalMatch) {
          console.log("   🎉 All item values match expected results!");
        } else {
          console.log("   ⚠️  Some item values do not match expected results");
        }
      } else {
        console.log(`   ❌ Expected SKU ${expectedSku} not found`);
      }

      // Verify shipping fee
      console.log(
        `   ✅ Shipping Fee: ${result.data.invoiceMetadata.shippingFee} (expected: ${expectedShippingFee})`
      );
      const shippingMatch =
        Math.abs(
          (result.data.invoiceMetadata.shippingFee || 0) - expectedShippingFee
        ) < 0.01;
      if (shippingMatch) {
        console.log("   🎉 Shipping fee matches expected result!");
      } else {
        console.log("   ⚠️  Shipping fee does not match expected result");
      }
    } else {
      console.log("❌ Parsing failed!");
      console.log(`   Error: ${result.error || "Unknown error"}`);
    }
  } catch (error) {
    console.error("💥 Test failed with exception:", error);
  }
}

// Run the test
testBuchteinerParser().catch(console.error);
