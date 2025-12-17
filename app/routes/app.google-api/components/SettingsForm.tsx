import { Form, TextField, Button, BlockStack } from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";
import type { GoogleAPISettings } from "../types";

interface SettingsFormProps {
  settings: GoogleAPISettings;
  oauth2Config: string;
  serviceAccountConfig: string;
  apiKey: string;
  spreadsheetId: string;
  onOAuth2ConfigChange: (value: string) => void;
  onServiceAccountConfigChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSpreadsheetIdChange: (value: string) => void;
  isSubmitting: boolean;
}

export function SettingsForm({
  oauth2Config,
  serviceAccountConfig,
  apiKey,
  spreadsheetId,
  onOAuth2ConfigChange,
  onServiceAccountConfigChange,
  onApiKeyChange,
  onSpreadsheetIdChange,
  isSubmitting,
}: SettingsFormProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          API Configuration
        </Text>

        <Form method="post">
          <input type="hidden" name="_action" value="save_settings" />
          <BlockStack gap="400">
            <TextField
              label="OAuth2 JSON Configuration"
              value={oauth2Config}
              onChange={onOAuth2ConfigChange}
              name="oauth2Config"
              multiline={4}
              placeholder='{"web":{"client_id":"...","client_secret":"...","project_id":"..."}}'
              helpText="Paste your OAuth2 JSON configuration from Google Cloud Console"
            />

            <TextField
              label="Service Account JSON Configuration"
              value={serviceAccountConfig}
              onChange={onServiceAccountConfigChange}
              name="serviceAccountConfig"
              multiline={6}
              placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
              helpText="Paste your Service Account JSON from Google Cloud Console (recommended for server apps)"
            />

            <TextField
              label="Google Sheets API Key"
              value={apiKey}
              onChange={onApiKeyChange}
              name="apiKey"
              type="password"
              placeholder="AIzaSy..."
              helpText="Alternative: Simple API key for reading public spreadsheets"
            />

            <TextField
              label="Spreadsheet ID for Testing"
              value={spreadsheetId}
              onChange={onSpreadsheetIdChange}
              name="spreadsheetId"
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
              helpText="The spreadsheet ID from the URL (between /d/ and /edit)"
            />

            <Button submit primary loading={isSubmitting} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Settings"}
            </Button>
          </BlockStack>
        </Form>
      </BlockStack>
    </Card>
  );
}

