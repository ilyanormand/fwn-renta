import {
  createServiceAccountServiceFromConfig,
  createOAuth2ServiceFromConfig,
} from "../../services/googleSheets";
import {
  updateCmpInSheets,
  type InvoiceItem as ProcessorInvoiceItem,
} from "../../services/googleSheets/cmpHandle/cmpCalculate";

// Load Google Sheets settings from JSON file
export async function loadGoogleSheetsSettings() {
  try {
    const fs = await import("fs");
    const { PATHS } = await import("../../utils/storage.server");
    const settingsPath = PATHS.GOOGLE_SETTINGS;

    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, "utf8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.log("Google Sheets settings file not found");
  }
  return {};
}

// Process invoice with Google Sheets integration
export async function processInvoiceWithGoogleSheets(
  invoice: any,
  admin: any,
  editedItems?: any[],
  editedShippingFee?: number
): Promise<{
  success: boolean;
  message: string;
  report?: string;
}> {
  try {
    const settings = await loadGoogleSheetsSettings();
    if (!settings.spreadsheetId) {
      return {
        success: false,
        message: "Google Sheets not configured - skipping CMP processing",
      };
    }
    const invoiceItems = mapInvoiceItemsToProcessorInvoiceItems(
      editedItems || invoice.items
    );
    console.log(
      `-----> Processing ${invoiceItems.length} items for Google Sheets CMP update`
    );

    // Get appropriate sheets service
    const { sheetsService, serviceType } = chooseService(settings);

    if (!sheetsService) {
      return {
        success: false,
        message:
          "Google Sheets authentication not available - skipping CMP processing",
      };
    }

    // Use edited shipping fee if available, otherwise use original from invoice
    const shippingFee =
      editedShippingFee !== undefined
        ? editedShippingFee
        : invoice.shippingFee || 0;
    console.log(
      `Shipping fee: ${shippingFee} (${editedShippingFee !== undefined ? "edited" : "original"})`
    );

    const result = await updateCmpInSheets(
      invoiceItems,
      sheetsService,
      shippingFee,
      admin
    );
    console.log(
      `-----> Google Sheets processing completed: ${result?.updated || 0} rows updated`
    );
    return {
      success: result.updated > 0,
      message: `Google Sheets CMP processing completed: ${result.updated} rows updated, ${result.skipped} skipped (${serviceType})`,
    };
  } catch (error: any) {
    console.error("-----> Google Sheets processing error:", error);
    return {
      success: false,
      message: `Google Sheets processing failed: ${error.message}`,
    };
  }
}

function mapInvoiceItemsToProcessorInvoiceItems(
  invoiceItems: any[]
): ProcessorInvoiceItem[] {
  return invoiceItems.map((item: any) => ({
    invoice_sku: item.sku,
    qty: item.quantity,
    unit_price: item.unitPrice,
  }));
}

// Choose appropriate Google Sheets service based on available authentication
function chooseService(settings: any): {
  sheetsService: any | null;
  serviceType: string;
} {
  let sheetsService = null;
  let serviceType = "None";

  // Try Service Account first
  if (settings.serviceAccountConfig) {
    console.log("-----> Using Service Account for CMP processing");
    try {
      sheetsService = createServiceAccountServiceFromConfig(
        settings.serviceAccountConfig
      );
      serviceType = "Service Account";
    } catch (error: any) {
      console.log("-----> Service Account failed:", error.message);
    }
  }

  // Fallback to OAuth2 if Service Account is not available
  if (!sheetsService && settings.oauth2Config && settings.oauth2Tokens) {
    console.log("-----> Using OAuth2 for CMP processing");
    try {
      const tokens = JSON.parse(settings.oauth2Tokens);
      sheetsService = createOAuth2ServiceFromConfig(
        settings.oauth2Config,
        tokens.access_token
      );
      serviceType = "OAuth2";
    } catch (error: any) {
      console.log("-----> OAuth2 failed:", error.message);
    }
  }

  return { sheetsService, serviceType };
}
