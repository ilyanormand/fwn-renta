import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { savePdfFile } from "../../utils/fileUpload.server";
import { createInvoice, markInvoiceAsError } from "../../utils/invoice.server";
import { createJob } from "../../utils/job.server";
import type { ActionData } from "./types";

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<Response> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const supplier = formData.get("supplier") as string;
  const file = formData.get("invoice") as File;

  // Validation
  if (!supplier) {
    return json<ActionData>(
      { error: "Please select a supplier" },
      { status: 400 }
    );
  }

  if (!file || file.size === 0) {
    return json<ActionData>(
      { error: "Please select a PDF file" },
      { status: 400 }
    );
  }

  // Generate unique invoice ID
  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Save the PDF file using our upload utility
    const uploadResult = await savePdfFile(file, invoiceId);

    if (!uploadResult.success) {
      return json<ActionData>(
        { error: uploadResult.error || "Failed to upload file" },
        { status: 400 }
      );
    }

    // Create invoice record in database with relative path
    const relativePath = `/pdfs/${uploadResult.fileName}`;
    const invoice = await createInvoice({
      supplierId: supplier,
      invoiceDate: new Date(), // Will be updated after PDF parsing
      shippingFee: 0, // Will be updated after PDF parsing
      discount: 0, // Will be updated after PDF parsing
      tax: 0, // Will be updated after PDF parsing
      currency: "EUR",
      status: "PROCESSING", // Start with PROCESSING status
      pdfFileName: uploadResult.fileName,
      pdfFilePath: relativePath, // Store relative path
      pdfFileSize: uploadResult.fileSize,
      items: [], // Will be populated after PDF parsing
    });

    console.log("Invoice created successfully:", {
      invoiceId: invoice.id,
      supplier: invoice.supplier.name,
      fileName: uploadResult.fileName,
      fileSize: uploadResult.fileSize,
      originalFileName: uploadResult.originalFileName,
    });

    // Queue PDF processing job instead of processing synchronously
    try {
      await createJob({
        type: "PDF_PROCESSING",
        data: {
          invoiceId: invoice.id,
          supplierName: invoice.supplier.name,
          fileName: uploadResult.fileName,
        },
        maxAttempts: 3,
      });
      console.log(`PDF processing job queued for invoice ${invoice.id}`);
    } catch (jobError) {
      console.error("Failed to queue PDF processing job:", jobError);
      await markInvoiceAsError(invoice.id);

      return json<ActionData>(
        {
          error:
            "Failed to queue processing job. Invoice has been marked as error.",
        },
        { status: 500 }
      );
    }

    // Return success with invoice ID for client-side navigation
    return json<ActionData>({
      success: true,
      invoiceId: invoice.id,
      message: "Invoice uploaded successfully!",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return json<ActionData>(
      { error: "Failed to process upload. Please try again." },
      { status: 500 }
    );
  }
};

