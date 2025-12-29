import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import {
  getGoogleSheetsService,
  createOAuth2ServiceFromConfig,
  createServiceAccountServiceFromConfig,
  createInvoiceProcessor,
  type InvoiceItem,
} from "../../services/googleSheets";
import { loadSettings, saveSettings } from "./settings.server";
import type { GoogleAPISettings, ActionResponse } from "./types";

export async function handleSaveSettings(
  formData: FormData,
  currentSettings: GoogleAPISettings
): Promise<ActionResponse> {
  const oauth2Config = formData.get("oauth2Config") as string;
  const serviceAccountConfig = formData.get("serviceAccountConfig") as string;
  const apiKey = formData.get("apiKey") as string;
  const spreadsheetId = formData.get("spreadsheetId") as string;

  const newSettings: GoogleAPISettings = {
    ...currentSettings,
  };

  if (oauth2Config) newSettings.oauth2Config = oauth2Config;
  if (serviceAccountConfig)
    newSettings.serviceAccountConfig = serviceAccountConfig;
  if (apiKey) newSettings.apiKey = apiKey;
  if (spreadsheetId) newSettings.spreadsheetId = spreadsheetId;

  await saveSettings(newSettings);

  return { success: true, message: "Settings saved successfully" };
}

export async function handleTestApi(
  settings: GoogleAPISettings
): Promise<ActionResponse> {
  console.log("-----> test_api");

  if (!settings.apiKey) {
    console.log("-----> API key not configured");
    return { error: "API key not configured" };
  }

  if (!settings.spreadsheetId) {
    console.log("-----> Spreadsheet ID not configured");
    return { error: "Spreadsheet ID not configured" };
  }

  try {
    console.log("-----> Testing connection");
    console.log("-----> API key length:", settings.apiKey?.length || 0);
    console.log("-----> Spreadsheet ID:", settings.spreadsheetId);
    const service = getGoogleSheetsService(settings.apiKey);
    const result = await service.testConnection(settings.spreadsheetId);
    console.log("-----> Test connection result", result);
    return {
      success: result.canRead,
      message: result.message,
      data: result.info,
      troubleshooting: result.troubleshooting,
      serviceType: "API Key",
    };
  } catch (error: any) {
    console.log("-----> Test connection error", error);
    return { error: `Test failed: ${error.message}` };
  }
}

export async function handleReadData(
  formData: FormData,
  settings: GoogleAPISettings
): Promise<ActionResponse> {
  const range = (formData.get("range") as string) || "Sheet1!A1:E10";

  if (!settings.apiKey) {
    return { error: "API key not configured" };
  }

  if (!settings.spreadsheetId) {
    return { error: "Spreadsheet ID not configured" };
  }

  try {
    const service = getGoogleSheetsService(settings.apiKey);
    const result = await service.readData(settings.spreadsheetId, range);

    return {
      success: true,
      message: `Data read successfully from ${range}`,
      data: {
        range,
        rowsCount: result?.values?.length || 0,
        values: result?.values?.slice(0, 10) || [],
      },
      serviceType: "API Key",
    };
  } catch (error: any) {
    return { error: `Read failed: ${error.message}` };
  }
}

export async function handleUpdateData(
  formData: FormData,
  settings: GoogleAPISettings
): Promise<ActionResponse> {
  console.log("-----> update_data");
  const range = formData.get("range") as string;
  const valuesData = formData.get("values") as string;

  if (!settings.spreadsheetId) {
    return { error: "Spreadsheet ID not configured" };
  }

  if (!range || !valuesData) {
    return { error: "Range and values are required" };
  }

  // Parse the values JSON
  let values;
  try {
    values = JSON.parse(valuesData);
    console.log("-----> values", values);
  } catch (error) {
    return { error: "Invalid JSON format for values" };
  }

  // Try Service Account first, then OAuth2, then fall back to API key
  if (settings.serviceAccountConfig) {
    console.log("-----> Using Service Account for write operation");
    try {
      const serviceAccountService = createServiceAccountServiceFromConfig(
        settings.serviceAccountConfig
      );
      const result = await serviceAccountService.updateData(
        settings.spreadsheetId,
        range,
        values
      );
      console.log("-----> Service Account result", result);

      if (result.success) {
        return {
          success: true,
          message: result.message,
          data: {
            range,
            updatedCells: result.updatedCells,
          },
          serviceType: "Service Account",
        };
      } else {
        return { error: result.message };
      }
    } catch (error: any) {
      console.log(
        "-----> Service Account failed, trying OAuth2:",
        error.message
      );
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
        oauth2Service = createOAuth2ServiceFromConfig(
          settings.oauth2Config,
          tokens.access_token
        );
      } else {
        console.log("-----> No stored tokens, OAuth2 requires authorization");
        // Return specific error for missing authorization
        return {
          error:
            "OAuth2 authorization required. Please authorize access to Google Sheets first.",
          requiresAuth: true,
          troubleshooting: [
            "OAuth2 is configured but not authorized",
            "You need to complete the authorization flow to get access tokens",
            "Click 'Authorize Google Sheets Access' to start the OAuth2 flow",
            "After authorization, tokens will be stored and write operations will work",
          ],
        };
      }

      const result = await oauth2Service.updateData(
        settings.spreadsheetId,
        range,
        values
      );
      console.log("-----> OAuth2 result", result);

      if (result.success) {
        return {
          success: true,
          message: result.message,
          data: {
            range,
            updatedCells: result.updatedCells,
          },
          serviceType: "OAuth2",
        };
      } else {
        return { error: result.message };
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
      const result = await service.updateData(
        settings.spreadsheetId,
        range,
        values
      );
      console.log("-----> API key result", result);

      if (result.success) {
        return {
          success: true,
          message: result.message,
          data: {
            range,
            updatedCells: result.updatedCells,
          },
          serviceType: "API Key",
        };
      } else {
        // Handle OAuth requirement specifically
        if (result.requiresOAuth) {
          return {
            error: result.message,
            requiresOAuth: true,
            troubleshooting: [
              "API keys cannot write to Google Sheets - only read access is supported",
              "OAuth2 configuration is available but authentication failed",
              "OAuth2 requires user authorization which is not yet implemented",
              "For now, use Google Sheets interface directly for editing",
            ],
          };
        }
        return { error: result.message };
      }
    } catch (error: any) {
      return { error: `API key update failed: ${error.message}` };
    }
  }

  return {
    error: "No authentication method configured (OAuth2 or API key required)",
  };
}

export async function handleOAuth2Authorize(
  request: Request,
  settings: GoogleAPISettings
): Promise<Response> {
  console.log("-----> OAuth2 authorize");
  if (!settings.oauth2Config) {
    return json({ error: "OAuth2 not configured" }, { status: 400 });
  }

  try {
    const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
    const redirectUri = `${new URL(request.url).origin}/app/google-api/callback`;
    console.log("-----> OAuth2 redirect URI:", redirectUri);
    console.log("-----> Request URL origin:", new URL(request.url).origin);
    const authUrl = oauth2Service.generateAuthUrl(
      redirectUri,
      "google-sheets-auth"
    );
    console.log("-----> Generated auth URL:", authUrl);

    // Redirect to Google for authorization
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
      },
    });
  } catch (error: any) {
    return json(
      { error: `OAuth2 authorization failed: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function handleOAuth2Callback(
  request: Request,
  settings: GoogleAPISettings
): Promise<ActionResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return { error: `OAuth2 authorization failed: ${error}` };
  }

  if (!code) {
    return { error: "No authorization code received" };
  }

  if (state !== "google-sheets-auth") {
    return { error: "Invalid state parameter" };
  }

  if (!settings.oauth2Config) {
    return { error: "OAuth2 not configured" };
  }

  try {
    const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
    const redirectUri = `${new URL(request.url).origin}/app/google-api/callback`;
    const tokens = await oauth2Service.exchangeCodeForTokens(code, redirectUri);

    // Store tokens in settings
    const updatedSettings = {
      ...settings,
      oauth2Tokens: JSON.stringify(tokens),
    };

    await saveSettings(updatedSettings);

    return {
      success: true,
      message:
        "OAuth2 authorization successful! You can now use write operations.",
      data: {
        hasTokens: true,
        expiryDate: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      },
    };
  } catch (error: any) {
    return { error: `Token exchange failed: ${error.message}` };
  }
}

export async function handleProcessInvoice(
  formData: FormData,
  settings: GoogleAPISettings
): Promise<ActionResponse> {
  console.log("-----> process_invoice");
  const invoiceItemsData = formData.get("invoiceItems") as string;

  if (!settings.spreadsheetId) {
    return { error: "Spreadsheet ID not configured" };
  }

  if (!invoiceItemsData) {
    return { error: "Invoice items data is required" };
  }

  // Parse invoice items
  let invoiceItems: InvoiceItem[];
  try {
    invoiceItems = JSON.parse(invoiceItemsData);
    console.log("-----> Invoice items:", invoiceItems.length);
  } catch (error) {
    return { error: "Invalid JSON format for invoice items" };
  }

  // Get appropriate sheets service
  let sheetsService;
  let serviceType = "API Key";

  if (settings.serviceAccountConfig) {
    console.log("-----> Using Service Account for invoice processing");
    try {
      sheetsService = createServiceAccountServiceFromConfig(
        settings.serviceAccountConfig
      );
      serviceType = "Service Account";
    } catch (error: any) {
      console.log(
        "-----> Service Account failed, trying OAuth2:",
        error.message
      );
    }
  }

  if (!sheetsService && settings.oauth2Config && settings.oauth2Tokens) {
    console.log("-----> Using OAuth2 for invoice processing");
    try {
      const tokens = JSON.parse(settings.oauth2Tokens);
      sheetsService = createOAuth2ServiceFromConfig(
        settings.oauth2Config,
        tokens.access_token
      );
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
    return { error: "No authentication method available" };
  }

  try {
    // Create invoice processor
    const processor = createInvoiceProcessor(settings.spreadsheetId);

    // Process the invoice
    const result = await processor.processInvoice(invoiceItems, sheetsService);

    return {
      success: result.updated > 0,
      message: `Processing completed: ${result.updated} rows updated, ${result.skipped} skipped`,
      data: {
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        notFound: result.notFound,
        ambiguous: result.ambiguous,
        errors: result.errors,
        report: result.report,
      },
      serviceType,
    };
  } catch (error: any) {
    return { error: `Invoice processing failed: ${error.message}` };
  }
}

// Main action handler
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  console.log("-----> action", actionType);

  try {
    const settings = await loadSettings();

    switch (actionType) {
      case "save_settings": {
        const result = await handleSaveSettings(formData, settings);
        return json(result);
      }

      case "test_api": {
        const result = await handleTestApi(settings);
        return json(result, {
          status: result.error ? 400 : 200,
        });
      }

      case "read_data": {
        const result = await handleReadData(formData, settings);
        return json(result, {
          status: result.error ? 400 : 200,
        });
      }

      case "update_data": {
        const result = await handleUpdateData(formData, settings);
        return json(result, {
          status: result.error
            ? result.requiresAuth
              ? 401
              : result.requiresOAuth
                ? 403
                : 400
            : 200,
        });
      }

      case "oauth2_authorize": {
        return await handleOAuth2Authorize(request, settings);
      }

      case "oauth2_callback": {
        const result = await handleOAuth2Callback(request, settings);
        return json(result, {
          status: result.error ? 400 : 200,
        });
      }

      case "process_invoice": {
        const result = await handleProcessInvoice(formData, settings);
        return json(result, {
          status: result.error ? 400 : 200,
        });
      }

      default:
        return json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Action error:", error);
    return json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
};
