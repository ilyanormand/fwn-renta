import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Divider,
  Box,
} from "@shopify/polaris";
import type { TransformedInvoice } from "../types";

interface InvoiceTotalsCardProps {
  extractedData: TransformedInvoice;
  editableShippingFee: string;
  onShippingFeeChange: (value: string) => void;
  calculateSubtotal: () => number;
  calculateTotal: () => number;
  isProcessing: boolean;
}

export function InvoiceTotalsCard({
  extractedData,
  editableShippingFee,
  onShippingFeeChange,
  calculateSubtotal,
  calculateTotal,
  isProcessing,
}: InvoiceTotalsCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="400" align="start">
          <div style={{ minWidth: "200px" }}>
            <TextField
              label="Shipping Fee (€)"
              value={editableShippingFee}
              onChange={onShippingFeeChange}
              type="number"
              step={0.01}
              autoComplete="off"
              disabled={isProcessing}
            />
          </div>
        </InlineStack>

        <Box padding="400" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                Subtotal:
              </Text>
              <Text variant="bodyMd" as="span">
                €{calculateSubtotal().toFixed(2)}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                Shipping:
              </Text>
              <Text variant="bodyMd" as="span">
                €{parseFloat(editableShippingFee || "0").toFixed(2)}
              </Text>
            </InlineStack>
            {extractedData.discount !== 0 && (
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span" tone="subdued">
                  Discount (applied to items):
                </Text>
                <Text variant="bodyMd" as="span" tone="subdued">
                  €{extractedData.discount.toFixed(2)}
                </Text>
              </InlineStack>
            )}
            <Divider />
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h3">
                Total:
              </Text>
              <Text variant="headingMd" as="h3">
                €{calculateTotal().toFixed(2)}
              </Text>
            </InlineStack>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
