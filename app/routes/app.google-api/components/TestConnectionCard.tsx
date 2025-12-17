import { Form, TextField, Button, BlockStack, InlineStack, Banner } from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";

interface TestConnectionCardProps {
  readRange: string;
  onReadRangeChange: (value: string) => void;
  hasApiKey: boolean;
  hasSpreadsheetId: boolean;
  isSubmitting: boolean;
}

export function TestConnectionCard({
  readRange,
  onReadRangeChange,
  hasApiKey,
  hasSpreadsheetId,
  isSubmitting,
}: TestConnectionCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Test Connection
        </Text>

        <InlineStack gap="300">
          <Form method="post">
            <input type="hidden" name="_action" value="test_api" />
            <Button
              submit
              loading={isSubmitting}
              disabled={!hasApiKey || !hasSpreadsheetId || isSubmitting}
            >
              Test API Connection
            </Button>
          </Form>

          <Form method="post">
            <input type="hidden" name="_action" value="read_data" />
            <input type="hidden" name="range" value={readRange} />
            <Button
              submit
              loading={isSubmitting}
              disabled={!hasApiKey || !hasSpreadsheetId || isSubmitting}
            >
              Read Test Data
            </Button>
          </Form>
        </InlineStack>

        <TextField
          label="Range to Read"
          value={readRange}
          onChange={onReadRangeChange}
          placeholder="Sheet1!A1:E10"
          helpText="Specify the range in A1 notation"
        />

        {(!hasApiKey || !hasSpreadsheetId) && (
          <Banner tone="warning">
            <p>
              Please configure both API Key and Spreadsheet ID to test the
              connection.
            </p>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

