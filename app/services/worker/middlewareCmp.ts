import {
  createServiceAccountServiceFromConfig,
  createOAuth2ServiceFromConfig,
} from "../../services/googleSheets";
import type { InvoiceItem as ProcessorInvoiceItem } from "../../services/googleSheets/cmpHandle/cmpCalculate";

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

export function mapInvoiceItemsToProcessorInvoiceItems(
  invoiceItems: any[]
): ProcessorInvoiceItem[] {
  return invoiceItems.map((item: any) => ({
    invoice_sku: item.sku,
    qty: item.quantity,
    unit_price: item.unitPrice,
  }));
}

// Choose appropriate Google Sheets service based on available authentication
export function chooseService(settings: any): {
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

type AdminClient = {
  graphql: (query: string, variables?: Record<string, any>) => Promise<any>;
};

export async function getAdminFromShopDomain(job: {
  data?: { shopDomain?: string };
}): Promise<AdminClient | null> {
  if (!job.data?.shopDomain) {
    return null;
  }

  const shopDomain = job.data.shopDomain;

  try {
    const db = (await import("../../db.server")).default;
    const shopRecord = await db.shop.findUnique({
      where: { shop: shopDomain },
    });

    if (!shopRecord?.adminAccessToken) {
      return null;
    }
    try {
      const { LATEST_API_VERSION } = await import("@shopify/shopify-api");
      const { apiVersion } = await import("../../shopify.server");

      const shop = shopRecord.shop;
      const accessToken = shopRecord.adminAccessToken;

      if (!accessToken) {
        throw new Error("Access token is missing from shop record");
      }

      const apiVersionToUse = apiVersion || LATEST_API_VERSION;
      const admin = {
        graphql: async (query: string, variables?: Record<string, any>) => {
          const url = `https://${shop}/admin/api/${apiVersionToUse}/graphql.json`;

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({
              query,
              variables,
            }),
          });

          const json = await response.json();

          if (json.errors) {
            throw new Error(
              `Shopify GraphQL errors: ${JSON.stringify(json.errors)}`
            );
          }

          return json;
        },
      };

      return admin;
    } catch (clientError) {
      return null;
    }
  } catch (authError) {
    return null;
  }
}
