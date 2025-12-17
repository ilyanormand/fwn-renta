import { BlockStack, InlineStack, Button } from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";

export function QuickLinksCard() {
  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">
          Quick Links
        </Text>

        <InlineStack gap="300">
          <Button
            url="https://console.cloud.google.com/apis/credentials"
            external="true"
          >
            Google Cloud Console
          </Button>
          <Button url="https://docs.google.com/spreadsheets" external="true">
            Google Sheets
          </Button>
          <Button url="/app">Back to Dashboard</Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

