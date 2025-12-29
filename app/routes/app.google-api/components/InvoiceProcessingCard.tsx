import {
  Form,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Banner,
} from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";

interface InvoiceProcessingCardProps {
  invoiceItems: string;
  onInvoiceItemsChange: (value: string) => void;
  hasServiceAccount: boolean;
  hasOAuth2: boolean;
  hasApiKey: boolean;
  hasSpreadsheetId: boolean;
  isSubmitting: boolean;
}

export function InvoiceProcessingCard({
  invoiceItems,
  onInvoiceItemsChange,
  hasServiceAccount,
  hasOAuth2,
  hasApiKey,
  hasSpreadsheetId,
  isSubmitting,
}: InvoiceProcessingCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Process Invoice (CMP Calculation)
        </Text>

        <Banner tone="info">
          <BlockStack gap="200">
            <Text variant="bodyMd" as="p" fontWeight="semibold">
              Automated CMP Processing
            </Text>
            <Text variant="bodyMd" as="p">
              This will process invoice items and update your Google Sheets with
              calculated CMP (weighted average prices). Make sure your
              spreadsheet has the correct structure: E=SKUs, G=CMP, H=Q_prev,
              I=Q_in, J=Old Price, K=New Price.
            </Text>
          </BlockStack>
        </Banner>

        <Form method="post">
          <input type="hidden" name="_action" value="process_invoice" />
          <input type="hidden" name="invoiceItems" value={invoiceItems} />

          <BlockStack gap="400">
            <TextField
              label="Invoice Items (JSON Format)"
              value={invoiceItems}
              onChange={onInvoiceItemsChange}
              multiline={8}
              placeholder='[{"invoice_sku": "ITEM001", "qty": 10, "unit_price": 25.50}, {"invoice_sku": "ITEM002", "qty": 5, "unit_price": 15.00}]'
              helpText="Enter invoice items as JSON array. Each item should have: invoice_sku, qty, unit_price"
            />

            <InlineStack gap="300">
              <Button
                submit
                primary
                loading={isSubmitting}
                disabled={
                  (!hasApiKey && !hasOAuth2 && !hasServiceAccount) ||
                  !hasSpreadsheetId ||
                  isSubmitting
                }
              >
                {isSubmitting
                  ? "Processing Invoice..."
                  : "Process Invoice & Update CMP"}
              </Button>

              <Button
                onClick={() => {
                  onInvoiceItemsChange(
                    '[{"invoice_sku": "SAMPLE-001", "qty": 20, "unit_price": 12.75}, {"invoice_sku": "SAMPLE-002", "qty": 15, "unit_price": 8.50}, {"invoice_sku": "SAMPLE-003", "qty": 30, "unit_price": 22.00}]'
                  );
                }}
              >
                Load Sample Invoice
              </Button>
            </InlineStack>

            {!hasApiKey && !hasOAuth2 && !hasServiceAccount && (
              <Banner tone="critical">
                <p>
                  No authentication method configured. Please configure Service
                  Account, OAuth2, or API Key.
                </p>
              </Banner>
            )}

            {!hasSpreadsheetId && (
              <Banner tone="warning">
                <p>Please configure Spreadsheet ID in the settings above.</p>
              </Banner>
            )}
          </BlockStack>
        </Form>
      </BlockStack>
    </Card>
  );
}
