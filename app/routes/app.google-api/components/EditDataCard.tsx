import {
  Form,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Banner,
} from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";

interface EditDataCardProps {
  updateRange: string;
  updateValues: string;
  onUpdateRangeChange: (value: string) => void;
  onUpdateValuesChange: (value: string) => void;
  hasServiceAccount: boolean;
  hasOAuth2: boolean;
  hasOAuth2Tokens: boolean;
  hasApiKey: boolean;
  hasSpreadsheetId: boolean;
  isSubmitting: boolean;
}

export function EditDataCard({
  updateRange,
  updateValues,
  onUpdateRangeChange,
  onUpdateValuesChange,
  hasServiceAccount,
  hasOAuth2,
  hasOAuth2Tokens,
  hasApiKey,
  hasSpreadsheetId,
  isSubmitting,
}: EditDataCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Edit Spreadsheet Data
        </Text>

        {hasServiceAccount ? (
          <Banner tone="success">
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" fontWeight="semibold">
                Service Account Ready for Write Operations
              </Text>
              <Text variant="bodyMd" as="p">
                Service Account is configured. Write operations will use Service
                Account authentication (no user authorization required).
              </Text>
            </BlockStack>
          </Banner>
        ) : hasOAuth2 && hasOAuth2Tokens ? (
          <Banner tone="success">
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" fontWeight="semibold">
                OAuth2 Ready for Write Operations
              </Text>
              <Text variant="bodyMd" as="p">
                OAuth2 is configured and authorized. Write operations will use
                OAuth2 authentication.
              </Text>
            </BlockStack>
          </Banner>
        ) : hasOAuth2 ? (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" fontWeight="semibold">
                OAuth2 Authorization Required
              </Text>
              <Text variant="bodyMd" as="p">
                OAuth2 is configured but you need to authorize access to Google
                Sheets to enable write operations.
              </Text>
              <Button primary url="/app/google-api?_action=oauth2_authorize">
                Authorize Google Sheets Access
              </Button>
            </BlockStack>
          </Banner>
        ) : (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" fontWeight="semibold">
                Important: Write Access Limitation
              </Text>
              <Text variant="bodyMd" as="p">
                API keys can only READ Google Sheets data. To UPDATE/WRITE
                data, you must use OAuth2 authentication.
              </Text>
              <Text variant="bodyMd" as="p">
                Configure OAuth2 in the settings above for full read/write
                access.
              </Text>
            </BlockStack>
          </Banner>
        )}

        <Form method="post">
          <input type="hidden" name="_action" value="update_data" />
          <input type="hidden" name="range" value={updateRange} />
          <input type="hidden" name="values" value={updateValues} />

          <BlockStack gap="400">
            <TextField
              label="Range to Update"
              value={updateRange}
              onChange={onUpdateRangeChange}
              placeholder="Sheet1!A1:E1"
              helpText="Specify the range to update in A1 notation (e.g., Sheet1!A1:C3 for a 3x3 area)"
            />

            <TextField
              label="Values (JSON Format)"
              value={updateValues}
              onChange={onUpdateValuesChange}
              multiline={6}
              placeholder='[["Value1", "Value2", "Value3"], ["Row2Col1", "Row2Col2", "Row2Col3"]]'
              helpText="Enter values as a JSON array. Each inner array represents a row. Example: [['A1', 'B1'], ['A2', 'B2']]"
            />

            <InlineStack gap="300">
              <Button
                submit
                primary
                loading={isSubmitting}
                disabled={
                  (!hasApiKey && !hasOAuth2) ||
                  !hasSpreadsheetId ||
                  isSubmitting
                }
              >
                {isSubmitting
                  ? "Updating..."
                  : hasOAuth2
                    ? "Update Data (OAuth2)"
                    : "Update Data (Requires OAuth2)"}
              </Button>

              <Button
                onClick={() => {
                  onUpdateValuesChange(
                    '[["Sample1", "Sample2", "Sample3"]]'
                  );
                  onUpdateRangeChange("Sheet1!A1:C1");
                }}
              >
                Load Sample Data
              </Button>
            </InlineStack>

            {((!hasApiKey && !hasOAuth2) || !hasSpreadsheetId) && (
              <Banner tone="warning">
                <p>
                  Please configure{" "}
                  {!hasSpreadsheetId ? "Spreadsheet ID" : ""}
                  {!hasSpreadsheetId && !hasApiKey && !hasOAuth2
                    ? " and "
                    : ""}
                  {!hasApiKey && !hasOAuth2 ? "OAuth2 or API Key" : ""} to
                  update data.
                </p>
              </Banner>
            )}
          </BlockStack>
        </Form>
      </BlockStack>
    </Card>
  );
}

