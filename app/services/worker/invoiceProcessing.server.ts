import {
  parseInvoiceFromPdf,
  type ParsedInvoiceData,
  type PdfExtractionResult,
} from "../parsers/pdfParsing.server";
import { getStoredPdfPath } from "../../utils/fileUpload.server";
import {
  getInvoiceById,
  updateInvoice,
  createLogEntry,
  UpdateInvoiceData,
} from "../../utils/invoice.server";
import { deleteJobById } from "../../utils/job.server";
import db from "../../db.server";

// Types
interface LineItem {
  supplierSku: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface MappedLineItem extends LineItem {
  productId?: string;
  fwnSku?: string;
  mappingFound: boolean;
}

interface InvoiceValidationResult {
  isValid: boolean;
  invoice: Awaited<ReturnType<typeof getInvoiceById>>;
  error?: string;
}

// Main function to process an uploaded invoice PDF
export async function processInvoicePdf(
  invoiceId: string,
  jobId: string
): Promise<void> {
  let invoice: Awaited<ReturnType<typeof getInvoiceById>> | null = null;

  try {
    console.log(`🔍 Starting PDF processing for invoice: ${invoiceId}`);

    // Step 1: Validate invoice
    const validation = await validateInvoice(invoiceId, jobId);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }
    invoice = validation.invoice!;

    // Step 2: Parse PDF file
    const parseResult = await parsePdfFile(invoice);
    if (!parseResult.success) {
      await handleParsingFailure(invoiceId, parseResult.error);
      return;
    }

    // Step 3: Process mapped data
    await processParsedData(invoiceId, invoice, parseResult);
    console.log(
      `🎉 PDF processing completed successfully for invoice ${invoiceId}`
    );
  } catch (error) {
    await handleProcessingError(invoiceId, jobId, error, invoice);
    throw error;
  }
}

// Validate invoice exists and has PDF file
async function validateInvoice(
  invoiceId: string,
  jobId: string
): Promise<InvoiceValidationResult> {
  const invoice = await getInvoiceById(invoiceId);

  if (!invoice) {
    console.error(`❌ Invoice ${invoiceId} not found in database`);
    return {
      isValid: false,
      invoice: null,
      error: `Invoice ${invoiceId} not found`,
    };
  }

  console.log(`✅ Invoice loaded:`, {
    id: invoice.id,
    supplier: invoice.supplier.name,
    status: invoice.status,
    pdfFileName: invoice.pdfFileName,
  });

  if (!invoice.pdfFileName) {
    console.error(`❌ Invoice ${invoiceId} has no PDF file`);
    await deleteJobById(jobId);
    return {
      isValid: false,
      invoice,
      error: `Invoice ${invoiceId} has no PDF file`,
    };
  }

  return { isValid: true, invoice };
}

// Parse PDF file and return result
async function parsePdfFile(
  invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>
): Promise<PdfExtractionResult> {
  await createLogEntry(
    invoice.id,
    "PROCESSING",
    "INFO",
    "Starting PDF parsing"
  );

  const pdfFilePath = getStoredPdfPath(invoice.pdfFileName!);
  console.log(`📁 PDF file path: ${pdfFilePath}`);
  console.log(`🔍 Calling PDF parser for supplier: "${invoice.supplier.name}"`);

  const parseResult = await parseInvoiceFromPdf(
    pdfFilePath,
    invoice.supplier.name
  );

  console.log(`🔍 PDF parsing result:`, {
    success: parseResult.success,
    itemsCount: parseResult.data?.lineItems?.length || 0,
    error: parseResult.error,
  });

  return parseResult;
}

// Handle parsing failure
async function handleParsingFailure(
  invoiceId: string,
  error?: string
): Promise<void> {
  console.error(`❌ PDF parsing failed:`, error);
  await updateInvoice(invoiceId, { status: "ERROR" });
  await createLogEntry(
    invoiceId,
    "PARSING",
    "ERROR",
    error || "PDF parsing failed"
  );
}

// Process mapped invoice data
async function processParsedData(
  invoiceId: string,
  invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>,
  parseResult: PdfExtractionResult
): Promise<void> {
  const parsedData = parseResult.data!;

  // Log mapping success
  await createLogEntry(
    invoiceId,
    "PARSING",
    "SUCCESS",
    `Extracted ${parsedData.lineItems.length} line items`
  );

  // Log warnings if any
  await logParsingWarnings(invoiceId, parseResult.warnings);

  // Map supplier SKUs to FWN products
  const mappedItems = await mapLineItemsToProducts(parsedData.lineItems);

  console.log(
    `📊 Mapped ${mappedItems.length} items, mapping status:`,
    mappedItems.slice(0, 3).map((item) => ({
      sku: item.supplierSku,
      mappingFound: item.mappingFound,
    }))
  );
  // Prepare update data
  const updateData = buildUpdateData(invoice, parsedData, mappedItems);
  // Update invoice in database
  await updateInvoiceInDatabase(invoiceId, updateData);
}

// Log parsing warnings
async function logParsingWarnings(
  invoiceId: string,
  warnings?: string[]
): Promise<void> {
  if (!warnings || warnings.length === 0) {
    return;
  }

  console.log(`⚠️ PDF parsing warnings:`, warnings);
  for (const warning of warnings) {
    await createLogEntry(invoiceId, "PARSING", "INFO", `Warning: ${warning}`);
  }
}

// Build update data from parsed invoice and mapped items
function buildUpdateData(
  invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>,
  parsedData: ParsedInvoiceData,
  mappedItems: MappedLineItem[]
): UpdateInvoiceData {
  return {
    invoiceDate: parsedData.invoiceMetadata.invoiceDate || invoice.invoiceDate,
    shippingFee: parsedData.invoiceMetadata.shippingFee,
    discount: parsedData.invoiceMetadata.discount,
    tax: parsedData.invoiceMetadata.tax,
    items: mappedItems.map((item) => ({
      sku: item.supplierSku,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
      productId: item.productId,
    })),
    status: "PENDING_REVIEW",
  };
}

// Update invoice in database with processed data
async function updateInvoiceInDatabase(
  invoiceId: string,
  updateData: UpdateInvoiceData
): Promise<void> {
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

  await createLogEntry(
    invoiceId,
    "PROCESSING",
    "SUCCESS",
    `Invoice processed successfully. Status: PENDING_REVIEW`
  );
}

// Handle processing errors
async function handleProcessingError(
  invoiceId: string,
  jobId: string,
  error: unknown,
  invoice: Awaited<ReturnType<typeof getInvoiceById>> | null
): Promise<void> {
  console.error(`❌ Error processing invoice ${invoiceId}:`, error);
  console.error(`❌ Error details:`, {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    invoiceId,
    invoice: invoice
      ? { id: invoice.id, supplier: invoice.supplier?.name }
      : null,
  });

  // Update status to ERROR if we have invoice
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
      error instanceof Error ? error.message : "Unknown processing error"
    );
    console.log(`✅ Error logged to database`);
  } catch (logError) {
    console.error(`❌ Failed to create error log entry:`, logError);
  }
}

// Map supplier SKUs to FWN products using SupplierSKU table
async function mapLineItemsToProducts(
  lineItems: LineItem[]
): Promise<MappedLineItem[]> {
  const mappedItems: MappedLineItem[] = [];

  for (const item of lineItems) {
    const mappedItem = await mapSingleLineItem(item);
    mappedItems.push(mappedItem);
  }

  return mappedItems;
}

// Map a single line item to FWN product
async function mapSingleLineItem(item: LineItem): Promise<MappedLineItem> {
  // Skip mapping if no SKU provided
  if (!item.supplierSku || item.supplierSku.trim() === "") {
    return {
      ...item,
      mappingFound: false,
    };
  }

  // Look up supplier SKU in SupplierSKU table
  const supplierSkuMapping = await db.supplierSKU.findFirst({
    where: {
      sku: item.supplierSku,
    },
    include: {
      product: true,
    },
  });

  return {
    ...item,
    productId: supplierSkuMapping?.product.id,
    fwnSku: supplierSkuMapping?.product.skuFwn,
    mappingFound: !!supplierSkuMapping,
  };
}
