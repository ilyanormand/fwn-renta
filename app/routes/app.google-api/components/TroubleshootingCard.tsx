import { BlockStack, Box } from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";

export function TroubleshootingCard() {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Common Issues & Solutions
        </Text>

        <Box
          padding="400"
          background="bg-surface-secondary"
          borderRadius="200"
        >
          <BlockStack gap="300">
            <Text variant="bodyMd" as="p" fontWeight="semibold">
              403 Permission Denied Error:
            </Text>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">
                • For reading: Make sure your spreadsheet is publicly
                accessible (Share → Anyone with link can view)
              </Text>
              <Text variant="bodyMd" as="p">
                • For editing: API keys cannot write to Google Sheets - OAuth2
                is required for all write operations
              </Text>
              <Text variant="bodyMd" as="p">
                • Verify your API key has Google Sheets API enabled in Google
                Cloud Console
              </Text>
              <Text variant="bodyMd" as="p">
                • Use OAuth2 configuration for full read/write access to any
                spreadsheet
              </Text>
            </BlockStack>

            <Text variant="bodyMd" as="p" fontWeight="semibold">
              API Key Setup:
            </Text>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">
                • Go to Google Cloud Console → APIs & Services → Credentials
              </Text>
              <Text variant="bodyMd" as="p">
                • Create API Key and enable Google Sheets API
              </Text>
              <Text variant="bodyMd" as="p">
                • API key should start with "AIza" and be ~39 characters long
              </Text>
            </BlockStack>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}

