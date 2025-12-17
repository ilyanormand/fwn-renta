import { Card, BlockStack, InlineStack, Text, TextField, Select } from "@shopify/polaris";
import type { TransformedInvoice } from "../types";

interface InvoiceInfoCardProps {
  extractedData: TransformedInvoice;
  suppliers: Array<{ label: string; value: string }>;
  editableSupplier: string;
  editableInvoiceDate: string;
  onSupplierChange: (value: string) => void;
  onInvoiceDateChange: (value: string) => void;
  isProcessing: boolean;
}

export function InvoiceInfoCard({
  extractedData,
  suppliers,
  editableSupplier,
  editableInvoiceDate,
  onSupplierChange,
  onInvoiceDateChange,
  isProcessing,
}: InvoiceInfoCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Invoice Information
        </Text>

        <InlineStack gap="400">
          <div style={{ flex: 1 }}>
            <Select
              label="Supplier"
              options={suppliers}
              value={editableSupplier}
              onChange={onSupplierChange}
              disabled={isProcessing}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="Invoice Date"
              value={editableInvoiceDate}
              onChange={onInvoiceDateChange}
              type="date"
              autoComplete="off"
              disabled={isProcessing}
            />
          </div>
        </InlineStack>

        <InlineStack gap="400">
          <div style={{ flex: 1 }}>
            <TextField
              label="Invoice Number"
              value={extractedData.invoiceNumber}
              disabled
              autoComplete="off"
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="Currency"
              value={extractedData.currency}
              disabled
              autoComplete="off"
            />
          </div>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

