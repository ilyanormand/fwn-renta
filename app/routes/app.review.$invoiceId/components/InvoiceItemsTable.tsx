import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  DataTable,
  Button,
  Pagination,
  EmptyState,
} from "@shopify/polaris";
import type { InvoiceItem } from "../types";

interface InvoiceItemsTableProps {
  items: InvoiceItem[];
  currentPage: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemUpdate: (itemId: string, field: string, value: string) => void;
  onItemRemove: (itemId: string) => void;
  onItemAdd: () => void;
  isProcessing: boolean;
}

export function InvoiceItemsTable({
  items,
  currentPage,
  itemsPerPage,
  onPageChange,
  onItemUpdate,
  onItemRemove,
  onItemAdd,
  isProcessing,
}: InvoiceItemsTableProps) {
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = items.slice(startIndex, endIndex);

  const headings = [
    "SKU",
    "Description",
    "Quantity",
    "Unit Price (€)",
    "Discount ",
    "Total (€)",
    "Actions",
  ];

  const tableRows = currentItems.map((item) => [
    <TextField
      key={`sku-${item.id}`}
      label=""
      labelHidden
      value={item.sku}
      onChange={(value: string) => onItemUpdate(item.id, "sku", value)}
      autoComplete="off"
      disabled={isProcessing}
    />,
    <TextField
      key={`name-${item.id}`}
      label=""
      labelHidden
      value={item.name}
      onChange={(value: string) => onItemUpdate(item.id, "name", value)}
      autoComplete="off"
      disabled={isProcessing}
    />,
    <TextField
      key={`quantity-${item.id}`}
      label=""
      labelHidden
      value={item.quantity.toString()}
      onChange={(value: string) => onItemUpdate(item.id, "quantity", value)}
      type="number"
      autoComplete="off"
      disabled={isProcessing}
    />,
    <TextField
      key={`unitPrice-${item.id}`}
      label=""
      labelHidden
      value={item.unitPrice.toString()}
      onChange={(value: string) => onItemUpdate(item.id, "unitPrice", value)}
      type="number"
      step={0.01}
      autoComplete="off"
      disabled={isProcessing}
    />,
    <Text key={`discount-${item.id}`} as="span" variant="bodyMd">
      €{item.quantity > 0 ? (item.total / item.quantity).toFixed(2) : "0.00"}
    </Text>,
    <Text key={`total-${item.id}`} as="span" variant="bodyMd">
      €{item.total.toFixed(2)}
    </Text>,
    <Button
      key={`remove-${item.id}`}
      variant="plain"
      tone="critical"
      onClick={() => onItemRemove(item.id)}
      disabled={items.length <= 1 || isProcessing}
    >
      Remove
    </Button>,
  ]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text variant="headingMd" as="h2">
            Invoice Items
          </Text>
          <Text variant="bodyMd" as="p" tone="subdued">
            {totalItems} total items
          </Text>
        </InlineStack>

        {totalItems === 0 ? (
          <EmptyState
            heading="No items found"
            action={{
              content: "Add Item",
              onAction: onItemAdd,
            }}
          />
        ) : (
          <>
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "numeric",
                "numeric",
                "numeric",
                "numeric",
                "text",
              ]}
              headings={headings}
              rows={tableRows}
            />

            {totalPages > 1 && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={currentPage > 1}
                  onPrevious={() => onPageChange(currentPage - 1)}
                  hasNext={currentPage < totalPages}
                  onNext={() => onPageChange(currentPage + 1)}
                  label={`Page ${currentPage} of ${totalPages}`}
                />
              </InlineStack>
            )}

            <InlineStack gap="200">
              <Button variant="plain" onClick={onItemAdd}>
                + Add Item
              </Button>
              <Text variant="bodyMd" as="p" tone="subdued">
                Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of{" "}
                {totalItems} items
              </Text>
            </InlineStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

