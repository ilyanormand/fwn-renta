import { Card, BlockStack, InlineStack, Button } from "@shopify/polaris";
import { Form, useNavigation } from "@remix-run/react";
import type { InvoiceItem } from "../types";

interface InvoiceActionsCardProps {
  editableItems: InvoiceItem[];
  editableSupplier: string;
  editableInvoiceDate: string;
  editableShippingFee: string;
  isSubmitting: boolean;
  isProcessing: boolean;
}

export function InvoiceActionsCard({
  editableItems,
  editableSupplier,
  editableInvoiceDate,
  editableShippingFee,
  isSubmitting,
  isProcessing,
}: InvoiceActionsCardProps) {
  const navigation = useNavigation();

  return (
    <Card>
      <BlockStack gap="300">
        <Form method="post">
          <input
            type="hidden"
            name="editedItems"
            value={JSON.stringify(editableItems)}
          />
          <input type="hidden" name="editedSupplier" value={editableSupplier} />
          <input
            type="hidden"
            name="editedInvoiceDate"
            value={editableInvoiceDate}
          />
          <input
            type="hidden"
            name="editedShippingFee"
            value={editableShippingFee}
          />

          <InlineStack gap="300">
            <button
              type="submit"
              name="_action"
              value="confirm"
              disabled={isSubmitting || isProcessing}
              style={{
                backgroundColor: "#008060",
                color: "white",
                border: "none",
                padding: "8px 16px",
                borderRadius: "4px",
                cursor:
                  isSubmitting || isProcessing ? "not-allowed" : "pointer",
                opacity: isSubmitting || isProcessing ? 0.6 : 1,
              }}
            >
              {isSubmitting && navigation.formData?.get("_action") === "confirm"
                ? "Importing..."
                : "Confirm & Import"}
            </button>

            <button
              type="submit"
              name="_action"
              value="reject"
              disabled={isSubmitting || isProcessing}
              style={{
                backgroundColor: "#f6f6f7",
                color: "#202223",
                border: "1px solid #c9cccf",
                padding: "8px 16px",
                borderRadius: "4px",
                cursor:
                  isSubmitting || isProcessing ? "not-allowed" : "pointer",
                opacity: isSubmitting || isProcessing ? 0.6 : 1,
              }}
            >
              Cancel Import
            </button>

            <button
              type="submit"
              name="_action"
              value="reparse"
              disabled={isSubmitting || isProcessing}
              style={{
                backgroundColor: "#f6f6f7",
                color: "#202223",
                border: "1px solid #c9cccf",
                padding: "8px 16px",
                borderRadius: "4px",
                cursor:
                  isSubmitting || isProcessing ? "not-allowed" : "pointer",
                opacity: isSubmitting || isProcessing ? 0.6 : 1,
              }}
            >
              Re-parse PDF
            </button>

            <Button url="/app/upload">Back to Upload</Button>
          </InlineStack>
        </Form>
      </BlockStack>
    </Card>
  );
}
