import { PythonTableParser } from "../app/services/pythonTableParser.server";
import path from "path";

/**
 * Test the Nutrimeo parser integration
 */
async function testNutrimeoIntegration() {
  console.log("🧪 Testing Nutrimeo parser integration...");

  const parser = new PythonTableParser();
  const pdfPath = path.join(process.cwd(), "samples", "Nutrimeo.pdf");

  try {
    // Test with explicit supplier name
    console.log("📄 Testing with supplier name 'Nutrimeo'...");
    const result = await parser.parse(pdfPath, "Nutrimeo");

    if (result.success) {
      console.log("✅ Nutrimeo parser integration successful!");
      console.log(
        `📊 Extracted ${result.data?.lineItems?.length || 0} line items`
      );
      console.log(`💰 Total amount: ${result.data?.invoiceMetadata?.total}`);
      console.log(
        `📋 Invoice number: ${result.data?.invoiceMetadata?.invoiceNumber}`
      );

      // Show first few line items
      if (result.data?.lineItems && result.data.lineItems.length > 0) {
        console.log("\n📦 Sample line items:");
        result.data.lineItems.slice(0, 3).forEach((item, index) => {
          console.log(
            `  ${index + 1}. ${item.supplierSku} - ${item.description}`
          );
          console.log(
            `     Qty: ${item.quantity}, Unit Price: ${item.unitPrice}, Total: ${item.total}`
          );
        });
      }

      if (result.warnings && result.warnings.length > 0) {
        console.log(`\n⚠️  Warnings: ${result.warnings.join(", ")}`);
      }
    } else {
      console.error("❌ Nutrimeo parser integration failed:");
      console.error(result.error);
    }

    // Test with case-insensitive supplier detection
    console.log("\n📄 Testing with supplier name 'nutrimeo' (lowercase)...");
    const result2 = await parser.parse(pdfPath, "nutrimeo");

    if (result2.success) {
      console.log("✅ Case-insensitive detection works!");
    } else {
      console.error("❌ Case-insensitive detection failed:");
      console.error(result2.error);
    }
  } catch (error) {
    console.error("💥 Test failed with exception:", error);
  }
}

// Run the test
testNutrimeoIntegration().catch(console.error);

export { testNutrimeoIntegration };
