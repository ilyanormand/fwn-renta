import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createOAuth2ServiceFromConfig } from "../services/googleSheets.server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { PATHS } from "../utils/storage.server";

// Load settings from JSON file
async function loadSettings() {
  try {
    const settingsPath = PATHS.GOOGLE_SETTINGS;
    
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.log('Settings file not found, using defaults');
  }
  return {};
}

// Save settings to JSON file
async function saveSettings(settings: any) {
  try {
    const settingsPath = PATHS.GOOGLE_SETTINGS;
    
    const updatedSettings = {
      ...settings,
      lastUpdated: new Date().toISOString()
    };
    
    writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving settings:', error);
    throw new Error('Failed to save settings');
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle OAuth2 error
  if (error) {
    console.error('OAuth2 error:', error);
    return redirect('/app/google-api?error=' + encodeURIComponent(`OAuth2 authorization failed: ${error}`));
  }

  // Validate state and code
  if (!code) {
    return redirect('/app/google-api?error=' + encodeURIComponent('No authorization code received'));
  }

  if (state !== 'google-sheets-auth') {
    return redirect('/app/google-api?error=' + encodeURIComponent('Invalid state parameter'));
  }

  const settings = await loadSettings();
  if (!settings.oauth2Config) {
    return redirect('/app/google-api?error=' + encodeURIComponent('OAuth2 not configured'));
  }

  try {
    const oauth2Service = createOAuth2ServiceFromConfig(settings.oauth2Config);
    const redirectUri = `${url.origin}/app/google-api/callback`;
    console.log("-----> Callback redirect URI:", redirectUri);
    console.log("-----> Callback URL origin:", url.origin);
    console.log("-----> Authorization code:", code);
    const tokens = await oauth2Service.exchangeCodeForTokens(code, redirectUri);
    
    // Store tokens in settings
    const updatedSettings = {
      ...settings,
      oauth2Tokens: JSON.stringify(tokens)
    };
    
    await saveSettings(updatedSettings);
    
    // Redirect back to main page with success message
    return redirect('/app/google-api?success=' + encodeURIComponent('OAuth2 authorization successful! You can now use write operations.'));
  } catch (error: any) {
    console.error('Token exchange failed:', error);
    return redirect('/app/google-api?error=' + encodeURIComponent(`Token exchange failed: ${error.message}`));
  }
};
