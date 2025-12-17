export interface InvoiceItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface TransformedInvoice {
  id: string;
  supplier: string;
  supplierId: string;
  invoiceDate: string;
  invoiceNumber: string;
  currency: string;
  shippingFee: number;
  discount: number;
  items: InvoiceItem[];
  filename: string;
  pdfUrl: string | null;
  pdfDownloadUrl: string | null;
  pdfFilePath: string | null;
  status: string;
  createdAt: string; // Serialized as string by Remix JSON
}
