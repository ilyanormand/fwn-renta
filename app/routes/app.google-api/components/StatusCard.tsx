import { BlockStack, InlineStack, Badge, Box, Divider } from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";
import type { GoogleAPISettings } from "../types";

interface StatusCardProps {
  settings: GoogleAPISettings;
  hasServiceAccount: boolean;
  hasOAuth2: boolean;
  hasOAuth2Tokens: boolean;
  hasApiKey: boolean;
  hasSpreadsheetId: boolean;
}

export function StatusCard({
  settings,
  hasServiceAccount,
  hasOAuth2,
  hasOAuth2Tokens,
  hasApiKey,
  hasSpreadsheetId,
}: StatusCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Current Status
        </Text>

        <Box
          padding="400"
          background="bg-surface-secondary"
          borderRadius="200"
        >
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                Service Account:
              </Text>
              <Badge tone={hasServiceAccount ? "success" : "attention"}>
                {hasServiceAccount ? "Configured" : "Not set"}
              </Badge>
            </InlineStack>

            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                OAuth2 Config:
              </Text>
              <Badge tone={hasOAuth2 ? "success" : "attention"}>
                {hasOAuth2 ? "Configured" : "Not set"}
              </Badge>
            </InlineStack>

            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                OAuth2 Authorization:
              </Text>
              <Badge tone={hasOAuth2Tokens ? "success" : "attention"}>
                {hasOAuth2Tokens ? "Authorized" : "Not authorized"}
              </Badge>
            </InlineStack>

            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                API Key:
              </Text>
              <Badge tone={hasApiKey ? "success" : "attention"}>
                {hasApiKey ? "Configured" : "Not set"}
              </Badge>
            </InlineStack>

            <InlineStack align="space-between">
              <Text variant="bodyMd" as="span">
                Spreadsheet ID:
              </Text>
              <Badge tone={hasSpreadsheetId ? "success" : "attention"}>
                {hasSpreadsheetId ? "Configured" : "Not set"}
              </Badge>
            </InlineStack>

            {settings.lastUpdated && (
              <>
                <Divider />
                <InlineStack align="space-between">
                  <Text variant="bodyMd" as="span">
                    Last Updated:
                  </Text>
                  <Text variant="bodyMd" as="span">
                    {new Date(settings.lastUpdated).toLocaleString()}
                  </Text>
                </InlineStack>
              </>
            )}
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}

