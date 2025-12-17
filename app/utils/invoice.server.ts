import db from "../db.server";
import type { InvoiceStatus, LogType } from "@prisma/client";
import { getPdfUrl } from "./fileUpload.server";
import type {
  InvoiceItem,
  TransformedInvoice,
} from "../routes/app.review.$invoiceId/types";

export interface CreateInvoiceData {
  supplierId: string;
  invoiceDate: Date;
  shippingFee: number;
  discount?: number;
  tax?: number;
  currency: string;
  status: InvoiceStatus;
  pdfFileName?: string;
  pdfFilePath?: string;
  pdfFileSize?: number;
  items: {
    sku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
    productId?: string;
  }[];
}

export interface UpdateInvoiceData {
  supplierId?: string;
  invoiceDate?: Date;
  shippingFee?: number;
  discount?: number;
  tax?: number;
  status?: InvoiceStatus;
  items?: {
    id?: string;
    sku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
    productId?: string;
  }[];
}

export async function createInvoice(data: CreateInvoiceData) {
  const invoice = await db.invoice.create({
    data: {
      supplierId: data.supplierId,
      invoiceDate: data.invoiceDate,
      shippingFee: data.shippingFee,
      discount: data.discount || 0,
      tax: data.tax || 0,
      currency: data.currency,
      status: data.status,
      pdfFileName: data.pdfFileName,
      pdfFilePath: data.pdfFilePath,
      pdfFileSize: data.pdfFileSize,
      pdfUploadedAt: data.pdfFileName ? new Date() : null,
      items: {
        create: data.items.map((item) => ({
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          productId: item.productId,
        })),
      },
    },
    include: {
      supplier: true,
      items: true,
      logs: true,
    },
  });

  // Create initial log entry
  await createLogEntry(
    invoice.id,
    "UPLOAD",
    "SUCCESS",
    "Invoice uploaded successfully"
  );

  return invoice;
}

export async function getInvoiceById(id: string) {
  return await db.invoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
      logs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function updateInvoice(id: string, data: UpdateInvoiceData) {
  // If items are provided, delete existing items and create new ones
  if (data.items) {
    await db.invoiceItem.deleteMany({
      where: { invoiceId: id },
    });
  }

  const invoice = await db.invoice.update({
    where: { id },
    data: {
      ...(data.supplierId && { supplierId: data.supplierId }),
      ...(data.invoiceDate && { invoiceDate: data.invoiceDate }),
      ...(data.shippingFee !== undefined && { shippingFee: data.shippingFee }),
      ...(data.discount !== undefined && { discount: data.discount }),
      ...(data.tax !== undefined && { tax: data.tax }),
      ...(data.status && { status: data.status }),
      ...(data.items && {
        items: {
          create: data.items.map((item) => ({
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            productId: item.productId,
          })),
        },
      }),
    },
    include: {
      supplier: true,
      items: true,
      logs: true,
    },
  });

  // Create log entry for update
  await createLogEntry(
    id,
    "VALIDATION",
    "SUCCESS",
    "Invoice updated successfully"
  );

  return invoice;
}

export async function getAllInvoices() {
  return await db.invoice.findMany({
    include: {
      supplier: true,
      items: true,
      logs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllSuppliers() {
  return await db.supplier.findMany({
    orderBy: { name: "asc" },
  });
}

// Helper function to mark invoice as error
// If update fails, we log the error but don't throw - invoice will remain in PROCESSING
// This is acceptable as it can be manually fixed or retried later
export async function markInvoiceAsError(invoiceId: string): Promise<void> {
  try {
    await updateInvoice(invoiceId, { status: "ERROR" });
  } catch (error) {
    console.error(`Failed to mark invoice ${invoiceId} as ERROR:`, error);
  }
}

// Transform database invoice data for the UI
export async function transformInvoiceForUI(
  invoice: any
): Promise<TransformedInvoice> {
  const pdfUrl = invoice.pdfFileName ? getPdfUrl(invoice.pdfFileName) : null;

  console.log("📄 PDF URL generated:", {
    pdfFileName: invoice.pdfFileName,
    pdfUrl: pdfUrl,
    status: invoice.status,
  });

  // Calculate gross total of items to distribute discount
  const itemsGrossTotal = invoice.items.reduce(
    (sum: number, item: any) => sum + (item.total || 0),
    0
  );
  const discount = invoice.discount || 0;

  return {
    id: invoice.id,
    supplier: invoice.supplier.name,
    supplierId: invoice.supplierId,
    invoiceDate: invoice.invoiceDate.toISOString().split("T")[0],
    invoiceNumber: `INV-${invoice.id.slice(-8).toUpperCase()}`,
    currency: invoice.currency,
    shippingFee: invoice.shippingFee,
    discount: discount,
    items: invoice.items.map((item: any): InvoiceItem => {
      // Apply discount proportionally if it exists and is non-zero
      // Discount is usually negative in invoice.discount
      let adjustedUnitPrice = item.unitPrice;
      let adjustedTotal = item.total;

      if (discount !== 0 && itemsGrossTotal !== 0) {
        // Calculate proportion of this item's total to the gross total
        const ratio = item.total / itemsGrossTotal;
        // Distribute discount amount (add because discount is negative)
        const itemDiscountShare = discount * ratio;

        adjustedTotal = item.total + itemDiscountShare;
        if (item.quantity > 0) {
          adjustedUnitPrice = adjustedTotal / item.quantity;
        }
      }

      return {
        id: item.id,
        sku: item.sku,
        name: item.description || item.product?.name || item.sku,
        quantity: item.quantity,
        unitPrice: adjustedUnitPrice,
        total: adjustedTotal,
      };
    }),
    filename: invoice.pdfFileName || "invoice.pdf",
    pdfUrl: pdfUrl,
    pdfDownloadUrl: pdfUrl,
    pdfFilePath: invoice.pdfFilePath || null,
    status: invoice.status,
    createdAt: invoice.createdAt.toISOString(),
  };
}

export async function createLogEntry(
  invoiceId: string,
  type: LogType,
  status: string,
  message: string
) {
  return await db.logEntry.create({
    data: {
      invoiceId,
      type,
      status,
      message,
    },
  });
}

export async function deleteInvoiceById(invoiceId: string) {
  const invoice = await getInvoiceById(invoiceId);

  if (!invoice) {
    return { success: false, status: "error", message: `Invoice not found` };
  }
  if (invoice.pdfFileName) {
    const { deletePdfFile } = await import("./fileUpload.server");
    const deleteResult = await deletePdfFile(invoice.pdfFileName);
    if (!deleteResult.success) {
      return {
        success: false,
        status: "error",
        message: `Failed to delete PDF file`,
      };
    }
  }
  const { getJobByInvoiceId, deleteJobById } = await import("./job.server");
  const job = await getJobByInvoiceId(invoiceId, "PDF_PROCESSING");
  if (job) {
    await deleteJobById(job.id);
  }
  await db.invoiceItem.deleteMany({
    where: { invoiceId },
  });
  await db.logEntry.deleteMany({
    where: { invoiceId },
  });
  await db.invoice.delete({
    where: { id: invoiceId },
  });

  return {
    success: true,
    status: "success",
    message: `Invoice deleted successfully`,
  };
}
