import { Card, BlockStack, Text } from "@shopify/polaris";

export function UploadInstructionsCard() {
  return (
    <Card>
      <BlockStack gap="200">
        <Text variant="headingMd" as="h3">
          Upload Instructions
        </Text>
        <Text variant="bodyMd" as="p">
          1. Select the supplier from the dropdown menu
        </Text>
        <Text variant="bodyMd" as="p">
          2. Upload a PDF invoice file
        </Text>
        <Text variant="bodyMd" as="p">
          3. Click "Upload Invoice" to process
        </Text>
        <Text variant="bodyMd" as="p">
          The system will automatically extract invoice data and calculate
          weighted average costs.
        </Text>
      </BlockStack>
    </Card>
  );
}

