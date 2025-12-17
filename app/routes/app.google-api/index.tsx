import { useState, useEffect } from "react";
import { useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Banner,
  BlockStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { loader } from "./loader.server";
import { action } from "./actions.server";
import { SettingsForm } from "./components/SettingsForm";
import { TestConnectionCard } from "./components/TestConnectionCard";
import { EditDataCard } from "./components/EditDataCard";
import { InvoiceProcessingCard } from "./components/InvoiceProcessingCard";
import { StatusCard } from "./components/StatusCard";
import { ResultsCard } from "./components/ResultsCard";
import { TroubleshootingCard } from "./components/TroubleshootingCard";
import { QuickLinksCard } from "./components/QuickLinksCard";
import { MessagesBanner } from "./components/MessagesBanner";
import type { ActionResponse } from "./types";

// Re-export loader and action for Remix
export { loader, action };

export default function GoogleSheetsAPI() {
  const {
    settings,
    hasOAuth2,
    hasServiceAccount,
    hasApiKey,
    hasSpreadsheetId,
    urlMessage,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResponse | undefined;
  const navigation = useNavigation();

  // Check if we have OAuth2 tokens
  const hasOAuth2Tokens = !!settings.oauth2Tokens;

  const [oauth2Config, setOAuth2Config] = useState(
    settings.oauth2Config || ""
  );
  const [serviceAccountConfig, setServiceAccountConfig] = useState(
    settings.serviceAccountConfig || ""
  );
  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  const [spreadsheetId, setSpreadsheetId] = useState(
    settings.spreadsheetId || ""
  );
  const [readRange, setReadRange] = useState("Sheet1!A1:E10");
  const [updateRange, setUpdateRange] = useState("Sheet1!A1:E1");
  const [updateValues, setUpdateValues] = useState(
    '[["Header1", "Header2", "Header3", "Header4", "Header5"]]'
  );
  const [invoiceItems, setInvoiceItems] = useState(
    '[{"invoice_sku": "ITEM001", "qty": 10, "unit_price": 25.50}, {"invoice_sku": "ITEM002", "qty": 5, "unit_price": 15.00}]'
  );

  const isSubmitting = navigation.state === "submitting";

  // Sync local editable state with latest data after revalidation
  useEffect(() => {
    setOAuth2Config(settings.oauth2Config || "");
    setServiceAccountConfig(settings.serviceAccountConfig || "");
    setApiKey(settings.apiKey || "");
    setSpreadsheetId(settings.spreadsheetId || "");
  }, [
    settings.oauth2Config,
    settings.serviceAccountConfig,
    settings.apiKey,
    settings.spreadsheetId,
  ]);

  return (
    <Page>
      <TitleBar title="Google Sheets API Management" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <p>
                Configure and test your Google Sheets API connection. You can
                use either an API key for reading public sheets or OAuth2 for
                full access.
              </p>
            </Banner>

            <MessagesBanner urlMessage={urlMessage} actionData={actionData} />

            <SettingsForm
              settings={settings}
              oauth2Config={oauth2Config}
              serviceAccountConfig={serviceAccountConfig}
              apiKey={apiKey}
              spreadsheetId={spreadsheetId}
              onOAuth2ConfigChange={setOAuth2Config}
              onServiceAccountConfigChange={setServiceAccountConfig}
              onApiKeyChange={setApiKey}
              onSpreadsheetIdChange={setSpreadsheetId}
              isSubmitting={
                isSubmitting &&
                navigation.formData?.get("_action") === "save_settings"
              }
            />

            <TestConnectionCard
              readRange={readRange}
              onReadRangeChange={setReadRange}
              hasApiKey={hasApiKey}
              hasSpreadsheetId={hasSpreadsheetId}
              isSubmitting={
                isSubmitting &&
                (navigation.formData?.get("_action") === "test_api" ||
                  navigation.formData?.get("_action") === "read_data")
              }
            />

            <EditDataCard
              updateRange={updateRange}
              updateValues={updateValues}
              onUpdateRangeChange={setUpdateRange}
              onUpdateValuesChange={setUpdateValues}
              hasServiceAccount={hasServiceAccount}
              hasOAuth2={hasOAuth2}
              hasOAuth2Tokens={hasOAuth2Tokens}
              hasApiKey={hasApiKey}
              hasSpreadsheetId={hasSpreadsheetId}
              isSubmitting={
                isSubmitting &&
                navigation.formData?.get("_action") === "update_data"
              }
            />

            <InvoiceProcessingCard
              invoiceItems={invoiceItems}
              onInvoiceItemsChange={setInvoiceItems}
              hasServiceAccount={hasServiceAccount}
              hasOAuth2={hasOAuth2}
              hasApiKey={hasApiKey}
              hasSpreadsheetId={hasSpreadsheetId}
              isSubmitting={
                isSubmitting &&
                navigation.formData?.get("_action") === "process_invoice"
              }
            />

            <StatusCard
              settings={settings}
              hasServiceAccount={hasServiceAccount}
              hasOAuth2={hasOAuth2}
              hasOAuth2Tokens={hasOAuth2Tokens}
              hasApiKey={hasApiKey}
              hasSpreadsheetId={hasSpreadsheetId}
            />

            {actionData?.data && <ResultsCard actionData={actionData} />}

            <TroubleshootingCard />

            <QuickLinksCard />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

