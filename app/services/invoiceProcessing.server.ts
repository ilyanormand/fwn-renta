import { parseInvoiceFromPdf } from "./pdfParsing.server";
import { getStoredPdfPath } from "../utils/fileUpload.server";
import {
  getInvoiceById,
  updateInvoice,
  createLogEntry,
  UpdateInvoiceData,
} from "../utils/invoice.server";
import db from "../db.server";

// Main function to process an uploaded invoice PDF
export async function processInvoicePdf(invoiceId: string): Promise<void> {
  let invoice;

  try {
    console.log(`🔍 Starting PDF processing for invoice: ${invoiceId}`);

    // Load invoice from database
    invoice = await getInvoiceById(invoiceId);

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceId} not found in database`);
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    console.log(`✅ Invoice loaded:`, {
      id: invoice.id,
      supplier: invoice.supplier.name,
      status: invoice.status,
      pdfFileName: invoice.pdfFileName,
    });

    if (!invoice.pdfFileName) {
      console.error(`❌ Invoice ${invoiceId} has no PDF file`);
      throw new Error(`Invoice ${invoiceId} has no PDF file`);
    }

    // Log processing start
    await createLogEntry(
      invoiceId,
      "PROCESSING",
      "INFO",
      "Starting PDF parsing",
    );

    // Get absolute path to PDF file
    const pdfFilePath = getStoredPdfPath(invoice.pdfFileName);
    console.log(`📁 PDF file path: ${pdfFilePath}`);

    // Parse PDF using supplier-specific parser
    // For Yamamoto and Swanson, Python parser will be used automatically
    // For other suppliers, we can optionally use Python parser
    console.log(
      `🔍 Calling PDF parser for supplier: "${invoice.supplier.name}"`,
    );
    const parseResult = await parseInvoiceFromPdf(
      pdfFilePath,
      invoice.supplier.name,
    );

    console.log(`🔍 PDF parsing result:`, {
      success: parseResult.success,
      itemsCount: parseResult.data?.lineItems?.length || 0,
      error: parseResult.error,
    });

    if (!parseResult.success || !parseResult.data) {
      console.error(`❌ PDF parsing failed:`, parseResult.error);
      // Update invoice status to ERROR
      await updateInvoice(invoiceId, { status: "ERROR" });
      await createLogEntry(
        invoiceId,
        "PARSING",
        "ERROR",
        parseResult.error || "PDF parsing failed",
      );
      return;
    }

    // Log parsing success
    await createLogEntry(
      invoiceId,
      "PARSING",
      "SUCCESS",
      `Extracted ${parseResult.data.lineItems.length} line items`,
    );

    // Log warnings if any
    if (parseResult.warnings) {
      console.log(`⚠️ PDF parsing warnings:`, parseResult.warnings);
      for (const warning of parseResult.warnings) {
        await createLogEntry(
          invoiceId,
          "PARSING",
          "INFO",
          `Warning: ${warning}`,
        );
      }
    }

    // Map supplier SKUs to FWN products and prepare invoice items
    console.log(
      `📊 Processing ${parseResult.data.lineItems.length} line items for supplier: ${invoice.supplier.name}`,
    );
    console.log(`📊 First few items:`, parseResult.data.lineItems.slice(0, 3));
    const mappedItems = await mapLineItemsToProducts(
      parseResult.data.lineItems,
      invoice.supplier.name,
    );
    console.log(
      `📊 Mapped ${mappedItems.length} items, mapping status:`,
      mappedItems.slice(0, 3).map((item) => ({
        sku: item.supplierSku,
        mappingFound: item.mappingFound,
      })),
    );

    // Keep PDF amounts exactly as parsed - shipping fee is tracked separately!
    const updateData: UpdateInvoiceData = {
      invoiceDate:
        parseResult.data.invoiceMetadata.invoiceDate || invoice.invoiceDate,
      shippingFee: parseResult.data.invoiceMetadata.shippingFee,
      discount: parseResult.data.invoiceMetadata.discount,
      tax: parseResult.data.invoiceMetadata.tax,
      items: mappedItems.map((item) => ({
        sku: item.supplierSku,
        description: item.description, // Include parsed description
        quantity: item.quantity,
        // Keep unit price exactly as in PDF (17.09)
        unitPrice: item.unitPrice,
        // Keep total exactly as in PDF (256.35)
        total: item.total,
        productId: item.productId,
      })),
      status: "PENDING_REVIEW",
    };

    // Update invoice in database
    console.log(`📊 Final update data:`, {
      itemCount: updateData.items?.length || 0,
      status: updateData.status,
      shippingFee: updateData.shippingFee,
      firstItems: updateData.items?.slice(0, 3).map((item) => ({
        sku: item.sku,
        qty: item.quantity,
        price: item.unitPrice,
      })),
    });

    console.log(`💾 Updating invoice in database...`);
    await updateInvoice(invoiceId, updateData);
    console.log(`✅ Invoice updated successfully`);

    // Log successful processing
    await createLogEntry(
      invoiceId,
      "PROCESSING",
      "SUCCESS",
      `Invoice processed successfully. Status: PENDING_REVIEW`,
    );

    console.log(
      `🎉 PDF processing completed successfully for invoice ${invoiceId}`,
    );

    // TODO: Trigger CMP recalculation for affected products
    // This would be implemented when the CMP calculation logic is added
  } catch (error) {
    console.error(`❌ Error processing invoice ${invoiceId}:`, error);
    console.error(`❌ Error details:`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      invoiceId,
      invoice: invoice
        ? { id: invoice.id, supplier: invoice.supplier?.name }
        : null,
    });

    // Update status to ERROR if we have invoice ID
    if (invoice) {
      try {
        await updateInvoice(invoiceId, { status: "ERROR" });
        console.log(`✅ Invoice status updated to ERROR`);
      } catch (updateError) {
        console.error(`❌ Failed to update invoice status:`, updateError);
      }
    }

    // Log error
    try {
      await createLogEntry(
        invoiceId,
        "PROCESSING",
        "ERROR",
        error instanceof Error ? error.message : "Unknown processing error",
      );
      console.log(`✅ Error logged to database`);
    } catch (logError) {
      console.error(`❌ Failed to create error log entry:`, logError);
    }

    throw error; // Re-throw for caller to handle
  }
}

// Map supplier SKUs to FWN products using SupplierSKU table
async function mapLineItemsToProducts(
  lineItems: Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>,
  supplierName: string,
): Promise<
  Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
    productId?: string;
    fwnSku?: string;
    mappingFound: boolean;
  }>
> {
  const mappedItems = [];

  for (const item of lineItems) {
    // Skip mapping if no SKU provided (some invoices have items without SKUs)
    let supplierSkuMapping = null;
    if (item.supplierSku && item.supplierSku.trim() !== "") {
      // Look up supplier SKU in SupplierSKU table
      supplierSkuMapping = await db.supplierSKU.findFirst({
        where: {
          sku: item.supplierSku,
          // Optionally filter by brand if supplier name matches
        },
        include: {
          product: true,
        },
      });
    }

    mappedItems.push({
      ...item,
      productId: supplierSkuMapping?.product.id,
      fwnSku: supplierSkuMapping?.product.skuFwn,
      mappingFound: !!supplierSkuMapping,
    });
  }

  return mappedItems;
}

// Calculate shipping fee per item based on total quantity
function calculateShippingFeePerItem(
  totalShippingFee: number,
  lineItems: Array<{ quantity: number }>,
): number {
  if (totalShippingFee <= 0) return 0;

  const totalQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);

  if (totalQuantity === 0) return 0;

  // Keep full precision for accurate calculations
  return totalShippingFee / totalQuantity;
}

// Re-parse an existing invoice (useful for fixing parsing errors)
export async function reprocessInvoicePdf(invoiceId: string): Promise<void> {
  // Clear existing items first
  await db.invoiceItem.deleteMany({
    where: { invoiceId },
  });

  // Log reprocessing start
  await createLogEntry(
    invoiceId,
    "PROCESSING",
    "INFO",
    "Reprocessing invoice PDF",
  );

  // Process again
  await processInvoicePdf(invoiceId);
}

// Get parsing statistics for an invoice
export async function getInvoiceParsingStats(invoiceId: string): Promise<{
  totalItems: number;
  mappedItems: number;
  unmappedItems: number;
  unmappedSkus: string[];
}> {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  const mappedItems = invoice.items.filter((item) => item.productId);
  const unmappedItems = invoice.items.filter((item) => !item.productId);

  return {
    totalItems: invoice.items.length,
    mappedItems: mappedItems.length,
    unmappedItems: unmappedItems.length,
    unmappedSkus: unmappedItems.map((item) => item.sku),
  };
}
