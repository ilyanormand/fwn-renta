import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { createOAuth2ServiceFromConfig } from "../../services/googleSheets";
import { loadSettings } from "./settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const settings = await loadSettings();
  const url = new URL(request.url);
  const successMessage = url.searchParams.get("success");
  const errorMessage = url.searchParams.get("error");
  const action = url.searchParams.get("_action");

  // Handle OAuth2 authorization via URL parameter
  if (action === "oauth2_authorize") {
    console.log("-----> OAuth2 authorize action triggered");
    console.log("-----> Settings oauth2Config:", !!settings.oauth2Config);

    if (!settings.oauth2Config) {
      console.log("-----> OAuth2 not configured");
      throw new Response("OAuth2 not configured", { status: 400 });
    }

    console.log("-----> Creating OAuth2 service");
    const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
    const redirectUri = `${url.origin}/app/google-api/callback`;
    console.log("-----> OAuth2 redirect URI:", redirectUri);
    console.log("-----> Request URL origin:", url.origin);
    console.log("-----> Full URL:", url.toString());

    const authUrl = oauth2Service.generateAuthUrl(
      redirectUri,
      "google-sheets-auth"
    );
    console.log("-----> Generated auth URL:", authUrl);
    console.log("-----> Redirecting to Google for authorization");

    // Redirect to Google for authorization
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
      },
    });
  }

  return json({
    settings,
    hasOAuth2: !!settings.oauth2Config,
    hasServiceAccount: !!settings.serviceAccountConfig,
    hasApiKey: !!settings.apiKey,
    hasSpreadsheetId: !!settings.spreadsheetId,
    urlMessage: successMessage
      ? { type: "success" as const, message: successMessage }
      : errorMessage
        ? { type: "error" as const, message: errorMessage }
        : null,
  });
};
