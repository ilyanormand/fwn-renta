import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  Form,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  TextField,
  Banner,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getGoogleSheetsService, createOAuth2ServiceFromConfig, createServiceAccountServiceFromConfig } from "../services/googleSheets.server";
import { createInvoiceProcessor, type InvoiceItem } from "../services/invoiceProcessor.server";

// Define types for better type safety
interface GoogleAPISettings {
  oauth2Config?: string;
  oauth2Tokens?: string;
  serviceAccountConfig?: string;
  apiKey?: string;
  spreadsheetId?: string;
  lastUpdated?: string;
}

interface TestResult {
  success: boolean;
  message: string;
  data?: any;
  serviceType?: string;
}

// Load settings from JSON file
async function loadSettings(): Promise<GoogleAPISettings> {
  try {
    const fs = await import('fs');
    const { PATHS } = await import('../utils/storage.server');
    const settingsPath = PATHS.GOOGLE_SETTINGS;
    
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.log('Settings file not found, using defaults');
  }
  return {};
}

// Save settings to JSON file
async function saveSettings(settings: GoogleAPISettings): Promise<void> {
  try {
    const fs = await import('fs');
    const { PATHS } = await import('../utils/storage.server');
    const settingsPath = PATHS.GOOGLE_SETTINGS;
    
    const updatedSettings = {
      ...settings,
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving settings:', error);
    throw new Error('Failed to save settings');
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const settings = await loadSettings();
  const url = new URL(request.url);
  const successMessage = url.searchParams.get('success');
  const errorMessage = url.searchParams.get('error');
  const action = url.searchParams.get('_action');

  // Handle OAuth2 authorization via URL parameter
  if (action === 'oauth2_authorize') {
    console.log("-----> OAuth2 authorize action triggered");
    console.log("-----> Settings oauth2Config:", !!settings.oauth2Config);
    
    if (!settings.oauth2Config) {
      console.log("-----> OAuth2 not configured");
      throw new Response('OAuth2 not configured', { status: 400 });
    }

    console.log("-----> Creating OAuth2 service");
    const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
    const redirectUri = `${url.origin}/app/google-api/callback`;
    console.log("-----> OAuth2 redirect URI:", redirectUri);
    console.log("-----> Request URL origin:", url.origin);
    console.log("-----> Full URL:", url.toString());
    
    const authUrl = oauth2Service.generateAuthUrl(redirectUri, 'google-sheets-auth');
    console.log("-----> Generated auth URL:", authUrl);
    console.log("-----> Redirecting to Google for authorization");
    
    // Redirect to Google for authorization
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl
      }
    });
  }

  return json({
    settings,
    hasOAuth2: !!settings.oauth2Config,
    hasServiceAccount: !!settings.serviceAccountConfig,
    hasApiKey: !!settings.apiKey,
    hasSpreadsheetId: !!settings.spreadsheetId,
    urlMessage: successMessage ? { type: 'success', message: successMessage } : 
                errorMessage ? { type: 'error', message: errorMessage } : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);  
  const formData = await request.formData();
  const action = formData.get("_action") as string;
  console.log("-----> action", action);
  try {
    switch (action) {
      case "save_settings": {
        const oauth2Config = formData.get("oauth2Config") as string;
        const serviceAccountConfig = formData.get("serviceAccountConfig") as string;
        const apiKey = formData.get("apiKey") as string;
        const spreadsheetId = formData.get("spreadsheetId") as string;

        const currentSettings = await loadSettings();
        const newSettings: GoogleAPISettings = {
          ...currentSettings,
        };

        if (oauth2Config) newSettings.oauth2Config = oauth2Config;
        if (serviceAccountConfig) newSettings.serviceAccountConfig = serviceAccountConfig;
        if (apiKey) newSettings.apiKey = apiKey;
        if (spreadsheetId) newSettings.spreadsheetId = spreadsheetId;

        await saveSettings(newSettings);

        return json({ success: true, message: "Settings saved successfully" });
      }

      case "test_api": {
        console.log("-----> test_api");
        const settings = await loadSettings();
        
        if (!settings.apiKey) {
          console.log("-----> API key not configured");
          return json({ error: "API key not configured" }, { status: 400 });
        }

        if (!settings.spreadsheetId) {
          console.log("-----> Spreadsheet ID not configured");
          return json({ error: "Spreadsheet ID not configured" }, { status: 400 });
        }

        try {
          console.log("-----> Testing connection");
          console.log("-----> API key length:", settings.apiKey?.length || 0);
          console.log("-----> Spreadsheet ID:", settings.spreadsheetId);
          const service = getGoogleSheetsService(settings.apiKey);
          const result = await service.testConnection(settings.spreadsheetId);
          console.log("-----> Test connection result", result);
          return json({
            success: result.canRead,
            message: result.message,
            data: result.info,
            troubleshooting: result.troubleshooting,
            serviceType: "API Key"
          });
          
        } catch (error: any) {
          console.log("-----> Test connection error", error);
          return json({ error: `Test failed: ${error.message}` }, { status: 500 });
        }
      }

      case "read_data": {
        const settings = await loadSettings();
        const range = formData.get("range") as string || "Sheet1!A1:E10";
        
        if (!settings.apiKey) {
          return json({ error: "API key not configured" }, { status: 400 });
        }

        if (!settings.spreadsheetId) {
          return json({ error: "Spreadsheet ID not configured" }, { status: 400 });
        }

        try {
          const service = getGoogleSheetsService(settings.apiKey);
          const result = await service.readData(settings.spreadsheetId, range);

          return json({
            success: true,
            message: `Data read successfully from ${range}`,
            data: {
              range,
              rowsCount: result?.values?.length || 0,
              values: result?.values?.slice(0, 10) || []
            },
            serviceType: "API Key"
          });
        } catch (error: any) {
          return json({ error: `Read failed: ${error.message}` }, { status: 500 });
        }
      }

      case "update_data": {
        console.log("-----> update_data");
        const settings = await loadSettings();
        const range = formData.get("range") as string;
        const valuesData = formData.get("values") as string;
        
        if (!settings.spreadsheetId) {
          return json({ error: "Spreadsheet ID not configured" }, { status: 400 });
        }

        if (!range || !valuesData) {
          return json({ error: "Range and values are required" }, { status: 400 });
        }

        // Parse the values JSON
        let values;
        try {
          values = JSON.parse(valuesData);
          console.log("-----> values", values);
        } catch (error) {
          return json({ error: "Invalid JSON format for values" }, { status: 400 });
        }

        // Try Service Account first, then OAuth2, then fall back to API key
        if (settings.serviceAccountConfig) {
          console.log("-----> Using Service Account for write operation");
          try {
            const serviceAccountService = createServiceAccountServiceFromConfig(settings.serviceAccountConfig);
            const result = await serviceAccountService.updateData(settings.spreadsheetId, range, values);
            console.log("-----> Service Account result", result);
            
            if (result.success) {
              return json({
                success: true,
                message: result.message,
                data: {
                  range,
                  updatedCells: result.updatedCells
                },
                serviceType: "Service Account"
              });
            } else {
              return json({ error: result.message }, { status: 500 });
            }
          } catch (error: any) {
            console.log("-----> Service Account failed, trying OAuth2:", error.message);
            // Fall through to OAuth2 attempt
          }
        }

        // Try OAuth2 if available
        if (settings.oauth2Config) {
          console.log("-----> Using OAuth2 for write operation");
          try {
            // Check if we have stored tokens
            let oauth2Service;
            if (settings.oauth2Tokens) {
              console.log("-----> Using stored OAuth2 tokens");
              const tokens = JSON.parse(settings.oauth2Tokens);
              oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config, tokens.access_token);
            } else {
              console.log("-----> No stored tokens, OAuth2 requires authorization");
              // Return specific error for missing authorization
              return json({ 
                error: "OAuth2 authorization required. Please authorize access to Google Sheets first.",
                requiresAuth: true,
                troubleshooting: [
                  "OAuth2 is configured but not authorized",
                  "You need to complete the authorization flow to get access tokens",
                  "Click 'Authorize Google Sheets Access' to start the OAuth2 flow",
                  "After authorization, tokens will be stored and write operations will work"
                ]
              }, { status: 401 });
            }
            
            const result = await oauth2Service.updateData(settings.spreadsheetId, range, values);
            console.log("-----> OAuth2 result", result);
            
            if (result.success) {
              return json({
                success: true,
                message: result.message,
                data: {
                  range,
                  updatedCells: result.updatedCells
                },
                serviceType: "OAuth2"
              });
            } else {
              return json({ error: result.message }, { status: 500 });
            }
          } catch (error: any) {
            console.log("-----> OAuth2 failed, trying API key:", error.message);
            // Fall through to API key attempt
          }
        }

        // Fallback to API key (will likely fail for write operations)
        if (settings.apiKey) {
          console.log("-----> Using API key for write operation (likely to fail)");
          try {
            const service = getGoogleSheetsService(settings.apiKey);
            const result = await service.updateData(settings.spreadsheetId, range, values);
            console.log("-----> API key result", result);
            
            if (result.success) {
              return json({
                success: true,
                message: result.message,
                data: {
                  range,
                  updatedCells: result.updatedCells
                },
                serviceType: "API Key"
              });
            } else {
              // Handle OAuth requirement specifically
              if (result.requiresOAuth) {
                return json({ 
                  error: result.message,
                  requiresOAuth: true,
                  troubleshooting: [
                    "API keys cannot write to Google Sheets - only read access is supported",
                    "OAuth2 configuration is available but authentication failed",
                    "OAuth2 requires user authorization which is not yet implemented",
                    "For now, use Google Sheets interface directly for editing"
                  ]
                }, { status: 403 });
              }
              return json({ error: result.message }, { status: 500 });
            }
          } catch (error: any) {
            return json({ error: `API key update failed: ${error.message}` }, { status: 500 });
          }
        }

        return json({ error: "No authentication method configured (OAuth2 or API key required)" }, { status: 400 });
      }

      case "oauth2_authorize": {
        const settings = await loadSettings();
        console.log("-----> OAuth2 authorize");
        if (!settings.oauth2Config) {
          return json({ error: "OAuth2 not configured" }, { status: 400 });
        }

        try {
          const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
          const redirectUri = `${new URL(request.url).origin}/app/google-api/callback`;
          console.log("-----> OAuth2 redirect URI:", redirectUri);
          console.log("-----> Request URL origin:", new URL(request.url).origin);
          const authUrl = oauth2Service.generateAuthUrl(redirectUri, 'google-sheets-auth');
          console.log("-----> Generated auth URL:", authUrl);
          
          // Redirect to Google for authorization
          return new Response(null, {
            status: 302,
            headers: {
              Location: authUrl
            }
          });
        } catch (error: any) {
          return json({ error: `OAuth2 authorization failed: ${error.message}` }, { status: 500 });
        }
      }

      case "oauth2_callback": {
        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          return json({ error: `OAuth2 authorization failed: ${error}` }, { status: 400 });
        }

        if (!code) {
          return json({ error: "No authorization code received" }, { status: 400 });
        }

        if (state !== 'google-sheets-auth') {
          return json({ error: "Invalid state parameter" }, { status: 400 });
        }

        const settings = await loadSettings();
        if (!settings.oauth2Config) {
          return json({ error: "OAuth2 not configured" }, { status: 400 });
        }

        try {
          const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
          const redirectUri = `${new URL(request.url).origin}/app/google-api/callback`;
          const tokens = await oauth2Service.exchangeCodeForTokens(code, redirectUri);
          
          // Store tokens in settings
          const updatedSettings = {
            ...settings,
            oauth2Tokens: JSON.stringify(tokens)
          };
          
          await saveSettings(updatedSettings);
          
          return json({
            success: true,
            message: "OAuth2 authorization successful! You can now use write operations.",
            data: {
              hasTokens: true,
              expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
            }
          });
        } catch (error: any) {
          return json({ error: `Token exchange failed: ${error.message}` }, { status: 500 });
        }
      }

      case "process_invoice": {
        console.log("-----> process_invoice");
        const settings = await loadSettings();
        const invoiceItemsData = formData.get("invoiceItems") as string;
        
        if (!settings.spreadsheetId) {
          return json({ error: "Spreadsheet ID not configured" }, { status: 400 });
        }

        if (!invoiceItemsData) {
          return json({ error: "Invoice items data is required" }, { status: 400 });
        }

        // Parse invoice items
        let invoiceItems: InvoiceItem[];
        try {
          invoiceItems = JSON.parse(invoiceItemsData);
          console.log("-----> Invoice items:", invoiceItems.length);
        } catch (error) {
          return json({ error: "Invalid JSON format for invoice items" }, { status: 400 });
        }

        // Get appropriate sheets service
        let sheetsService;
        let serviceType = "API Key";

        if (settings.serviceAccountConfig) {
          console.log("-----> Using Service Account for invoice processing");
          try {
            sheetsService = createServiceAccountServiceFromConfig(settings.serviceAccountConfig);
            serviceType = "Service Account";
          } catch (error: any) {
            console.log("-----> Service Account failed, trying OAuth2:", error.message);
          }
        }

        if (!sheetsService && settings.oauth2Config && settings.oauth2Tokens) {
          console.log("-----> Using OAuth2 for invoice processing");
          try {
            const tokens = JSON.parse(settings.oauth2Tokens);
            sheetsService = createOAuth2ServiceFromConfig(settings.oauth2Config, tokens.access_token);
            serviceType = "OAuth2";
          } catch (error: any) {
            console.log("-----> OAuth2 failed, trying API key:", error.message);
          }
        }

        if (!sheetsService && settings.apiKey) {
          console.log("-----> Using API key for invoice processing (read-only)");
          sheetsService = getGoogleSheetsService(settings.apiKey);
          serviceType = "API Key (Read-Only)";
        }

        if (!sheetsService) {
          return json({ error: "No authentication method available" }, { status: 400 });
        }

        try {
          // Create invoice processor
          const processor = createInvoiceProcessor(settings.spreadsheetId);
          
          // Process the invoice
          const result = await processor.processInvoice(invoiceItems, sheetsService);
          
          return json({
            success: result.updated > 0,
            message: `Processing completed: ${result.updated} rows updated, ${result.skipped} skipped`,
            data: {
              processed: result.processed,
              updated: result.updated,
              skipped: result.skipped,
              notFound: result.notFound,
              ambiguous: result.ambiguous,
              errors: result.errors,
              report: result.report
            },
            serviceType
          });
        } catch (error: any) {
          return json({ error: `Invoice processing failed: ${error.message}` }, { status: 500 });
        }
      }

      default:
        return json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Action error:", error);
    return json({ error: error.message || "Internal server error" }, { status: 500 });
  }
};

export default function GoogleSheetsAPI() {
  const { settings, hasOAuth2, hasServiceAccount, hasApiKey, hasSpreadsheetId, urlMessage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();
  
  // Check if we have OAuth2 tokens
  const hasOAuth2Tokens = !!(settings.oauth2Tokens);

  const [oauth2Config, setOAuth2Config] = useState(settings.oauth2Config || "");
  const [serviceAccountConfig, setServiceAccountConfig] = useState(settings.serviceAccountConfig || "");
  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  const [spreadsheetId, setSpreadsheetId] = useState(settings.spreadsheetId || "");
  const [readRange, setReadRange] = useState("Sheet1!A1:E10");
  const [updateRange, setUpdateRange] = useState("Sheet1!A1:E1");
  const [updateValues, setUpdateValues] = useState('[["Header1", "Header2", "Header3", "Header4", "Header5"]]');
  const [invoiceItems, setInvoiceItems] = useState('[{"invoice_sku": "ITEM001", "qty": 10, "unit_price": 25.50}, {"invoice_sku": "ITEM002", "qty": 5, "unit_price": 15.00}]');

  const isSubmitting = navigation.state === "submitting";

  // Sync local editable state with latest data after revalidation (same as review page)
  useEffect(() => {
    setOAuth2Config(settings.oauth2Config || "");
    setServiceAccountConfig(settings.serviceAccountConfig || "");
    setApiKey(settings.apiKey || "");
    setSpreadsheetId(settings.spreadsheetId || "");
  }, [settings.oauth2Config, settings.serviceAccountConfig, settings.apiKey, settings.spreadsheetId]);

  return (
    <Page>
      <TitleBar title="Google Sheets API Management" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <p>
                Configure and test your Google Sheets API connection. You can use either 
                an API key for reading public sheets or OAuth2 for full access.
              </p>
            </Banner>

            {urlMessage && (
              <Banner tone={urlMessage.type === 'success' ? "success" : "critical"}>
                {urlMessage.message}
              </Banner>
            )}

            {actionData && "error" in actionData && actionData.error && (
              <Banner tone="critical">{actionData.error}</Banner>
            )}

            {actionData && "success" in actionData && actionData.success && (
              <Banner tone="success">
                {actionData.message || "Operation completed successfully"}
                {actionData.data && actionData.serviceType && (
                  <p>Service: {actionData.serviceType}</p>
                )}
              </Banner>
            )}

            {actionData && "success" in actionData && !actionData.success && actionData.troubleshooting && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                    Troubleshooting Tips:
                  </Text>
                  {actionData.troubleshooting.map((tip: string, index: number) => (
                    <Text key={index} variant="bodyMd" as="p">
                      {tip}
                    </Text>
                  ))}
                </BlockStack>
              </Banner>
            )}

            {/* Settings Form */}
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
                      onChange={setOAuth2Config}
                      name="oauth2Config"
                      multiline={4}
                      placeholder='{"web":{"client_id":"...","client_secret":"...","project_id":"..."}}'
                      helpText="Paste your OAuth2 JSON configuration from Google Cloud Console"
                    />

                    <TextField
                      label="Service Account JSON Configuration"
                      value={serviceAccountConfig}
                      onChange={setServiceAccountConfig}
                      name="serviceAccountConfig"
                      multiline={6}
                      placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
                      helpText="Paste your Service Account JSON from Google Cloud Console (recommended for server apps)"
                    />

                    <TextField
                      label="Google Sheets API Key"
                      value={apiKey}
                      onChange={setApiKey}
                      name="apiKey"
                      type="password"
                      placeholder="AIzaSy..."
                      helpText="Alternative: Simple API key for reading public spreadsheets"
                    />

                    <TextField
                      label="Spreadsheet ID for Testing"
                      value={spreadsheetId}
                      onChange={setSpreadsheetId}
                      name="spreadsheetId"
                      placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                      helpText="The spreadsheet ID from the URL (between /d/ and /edit)"
                    />

                    <Button
                      submit
                      primary
                      loading={isSubmitting && navigation.formData?.get("_action") === "save_settings"}
                      disabled={isSubmitting}
                    >
                      {isSubmitting && navigation.formData?.get("_action") === "save_settings"
                        ? "Saving..."
                        : "Save Settings"}
                    </Button>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>

            {/* Test Actions */}
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
                      loading={isSubmitting && navigation.formData?.get("_action") === "test_api"}
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
                      loading={isSubmitting && navigation.formData?.get("_action") === "read_data"}
                      disabled={!hasApiKey || !hasSpreadsheetId || isSubmitting}
                    >
                      Read Test Data
                    </Button>
                  </Form>
                </InlineStack>

                <TextField
                  label="Range to Read"
                  value={readRange}
                  onChange={setReadRange}
                  placeholder="Sheet1!A1:E10"
                  helpText="Specify the range in A1 notation"
                />

                {(!hasApiKey || !hasSpreadsheetId) && (
                  <Banner tone="warning">
                    <p>Please configure both API Key and Spreadsheet ID to test the connection.</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>

            {/* Edit Data */}
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
                        Service Account is configured. Write operations will use Service Account authentication (no user authorization required).
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
                        OAuth2 is configured and authorized. Write operations will use OAuth2 authentication.
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
                        OAuth2 is configured but you need to authorize access to Google Sheets to enable write operations.
                      </Text>
                      <Button 
                        primary
                        url="/app/google-api?_action=oauth2_authorize"
                      >
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
                        API keys can only READ Google Sheets data. To UPDATE/WRITE data, you must use OAuth2 authentication.
                      </Text>
                      <Text variant="bodyMd" as="p">
                        Configure OAuth2 in the settings above for full read/write access.
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
                      onChange={setUpdateRange}
                      placeholder="Sheet1!A1:E1"
                      helpText="Specify the range to update in A1 notation (e.g., Sheet1!A1:C3 for a 3x3 area)"
                    />

                    <TextField
                      label="Values (JSON Format)"
                      value={updateValues}
                      onChange={setUpdateValues}
                      multiline={6}
                      placeholder='[["Value1", "Value2", "Value3"], ["Row2Col1", "Row2Col2", "Row2Col3"]]'
                      helpText="Enter values as a JSON array. Each inner array represents a row. Example: [['A1', 'B1'], ['A2', 'B2']]"
                    />

                    <InlineStack gap="300">
                      <Button
                        submit
                        primary
                        loading={isSubmitting && navigation.formData?.get("_action") === "update_data"}
                        disabled={(!hasApiKey && !hasOAuth2) || !hasSpreadsheetId || isSubmitting}
                      >
                        {isSubmitting && navigation.formData?.get("_action") === "update_data"
                          ? "Updating..."
                          : hasOAuth2 ? "Update Data (OAuth2)" : "Update Data (Requires OAuth2)"}
                      </Button>

                      <Button
                        onClick={() => {
                          setUpdateValues('[["Sample1", "Sample2", "Sample3"]]');
                          setUpdateRange("Sheet1!A1:C1");
                        }}
                      >
                        Load Sample Data
                      </Button>
                    </InlineStack>

                    {((!hasApiKey && !hasOAuth2) || !hasSpreadsheetId) && (
                      <Banner tone="warning">
                        <p>Please configure {!hasSpreadsheetId ? "Spreadsheet ID" : ""}{!hasSpreadsheetId && (!hasApiKey && !hasOAuth2) ? " and " : ""}{(!hasApiKey && !hasOAuth2) ? "OAuth2 or API Key" : ""} to update data.</p>
                      </Banner>
                    )}
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>

            {/* Invoice Processing */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Process Invoice (CMP Calculation)
                </Text>

                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      Automated CMP Processing
                    </Text>
                    <Text variant="bodyMd" as="p">
                      This will process invoice items and update your Google Sheets with calculated CMP (weighted average prices).
                      Make sure your spreadsheet has the correct structure: E=SKUs, G=CMP, H=Q_prev, I=Q_in, J=Old Price, K=New Price.
                    </Text>
                  </BlockStack>
                </Banner>

                <Form method="post">
                  <input type="hidden" name="_action" value="process_invoice" />
                  <input type="hidden" name="invoiceItems" value={invoiceItems} />
                  
                  <BlockStack gap="400">
                    <TextField
                      label="Invoice Items (JSON Format)"
                      value={invoiceItems}
                      onChange={setInvoiceItems}
                      multiline={8}
                      placeholder='[{"invoice_sku": "ITEM001", "qty": 10, "unit_price": 25.50}, {"invoice_sku": "ITEM002", "qty": 5, "unit_price": 15.00}]'
                      helpText="Enter invoice items as JSON array. Each item should have: invoice_sku, qty, unit_price"
                    />

                    <InlineStack gap="300">
                      <Button
                        submit
                        primary
                        loading={isSubmitting && navigation.formData?.get("_action") === "process_invoice"}
                        disabled={(!hasApiKey && !hasOAuth2 && !hasServiceAccount) || !hasSpreadsheetId || isSubmitting}
                      >
                        {isSubmitting && navigation.formData?.get("_action") === "process_invoice"
                          ? "Processing Invoice..."
                          : "Process Invoice & Update CMP"}
                      </Button>

                      <Button
                        onClick={() => {
                          setInvoiceItems('[{"invoice_sku": "SAMPLE-001", "qty": 20, "unit_price": 12.75}, {"invoice_sku": "SAMPLE-002", "qty": 15, "unit_price": 8.50}, {"invoice_sku": "SAMPLE-003", "qty": 30, "unit_price": 22.00}]');
                        }}
                      >
                        Load Sample Invoice
                      </Button>
                    </InlineStack>

                    {(!hasApiKey && !hasOAuth2 && !hasServiceAccount) && (
                      <Banner tone="critical">
                        <p>No authentication method configured. Please configure Service Account, OAuth2, or API Key.</p>
                      </Banner>
                    )}

                    {!hasSpreadsheetId && (
                      <Banner tone="warning">
                        <p>Please configure Spreadsheet ID in the settings above.</p>
                      </Banner>
                    )}
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>

            {/* Current Status */}
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

            {/* Results Display */}
            {actionData && actionData.data && (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    {actionData.serviceType ? `Results (${actionData.serviceType})` : "Results"}
                  </Text>

                  {actionData.data.values && (
                    <Box
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <Text variant="bodyMd" as="p">
                          Range: {actionData.data.range}
                        </Text>
                        <Text variant="bodyMd" as="p">
                          Rows: {actionData.data.rowsCount}
                        </Text>
                        
                        {actionData.data.values.length > 0 && (
                          <div>
                            <Text variant="bodyMd" as="p" fontWeight="semibold">
                              First few rows:
                            </Text>
                            <pre style={{ 
                              fontSize: "12px", 
                              background: "#f9f9f9", 
                              padding: "10px", 
                              borderRadius: "4px",
                              overflow: "auto",
                              maxHeight: "200px"
                            }}>
                              {actionData.data.values.map((row: any[], index: number) => 
                                `Row ${index + 1}: ${row.join(' | ')}`
                              ).join('\n')}
                            </pre>
                          </div>
                        )}
                      </BlockStack>
                    </Box>
                  )}

                  {actionData.data && !actionData.data.values && (
                    <pre style={{ 
                      fontSize: "12px", 
                      background: "#f9f9f9", 
                      padding: "10px",
                      borderRadius: "4px"
                    }}>
                      {JSON.stringify(actionData.data, null, 2)}
                    </pre>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* Common Issues & Solutions */}
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
                        • For reading: Make sure your spreadsheet is publicly accessible (Share → Anyone with link can view)
                      </Text>
                      <Text variant="bodyMd" as="p">
                        • For editing: API keys cannot write to Google Sheets - OAuth2 is required for all write operations
                      </Text>
                      <Text variant="bodyMd" as="p">
                        • Verify your API key has Google Sheets API enabled in Google Cloud Console
                      </Text>
                      <Text variant="bodyMd" as="p">
                        • Use OAuth2 configuration for full read/write access to any spreadsheet
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

            {/* Quick Actions */}
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
                  <Button 
                    url="https://docs.google.com/spreadsheets" 
                    external="true"
                  >
                    Google Sheets
                  </Button>
                  <Button url="/app">
                    Back to Dashboard
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}