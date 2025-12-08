// Simple Google Sheets service for API key authentication
// Uses direct HTTP requests to Google Sheets API

// Загрузка .env файла (аналогично notify.ts)
function loadDotEnvIfPresent() {
  try {
    // Lazy, dependency-free .env loader (only if dotenv is not installed)
    if (!process.env.GOOGLE_OAUTH_CONFIG) {
      const fs = require("fs");
      const path = require("path");
      const envPath = path.join(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
          if (!m) continue;
          const key = m[1];
          let val = m[2];
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (process.env[key] == null) process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore; environment will fall back to defaults below
  }
}

loadDotEnvIfPresent();

export interface SheetData {
  values: Array<Array<string | number | boolean>>;
}

export interface OAuth2Config {
  client_id: string;
  client_secret: string;
  project_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
}

export interface OAuth2Tokens {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

export interface ServiceAccountConfig {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain?: string;
}

export class GoogleSheetsService {
  private apiKey: string;
  private baseUrl: string = 'https://sheets.googleapis.com/v4/spreadsheets';

  constructor(apiKey?: string) {
    // Поддерживаем как API ключ, так и извлечение из OAuth конфигурации
    this.apiKey = apiKey || process.env.GOOGLE_SHEETS_API_KEY || '';
    
    // Если нет API ключа, пробуем извлечь информацию из OAuth конфигурации
    if (!this.apiKey && process.env.GOOGLE_OAUTH_CONFIG) {
      console.log('ℹ️ No API key provided, OAuth config available but not supported in this simple service');
      console.log('💡 For OAuth2 support, use the full OAuth service');
    }
    
    if (!this.apiKey) {
      throw new Error('Google Sheets API key not found. Set GOOGLE_SHEETS_API_KEY environment variable.');
    }
  }

  async readData(spreadsheetId: string, range: string): Promise<SheetData | null> {
    try {
      // Clean spreadsheet ID (remove trailing slashes)
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const encodedRange = encodeURIComponent(range);
      const url = `${this.baseUrl}/${cleanSpreadsheetId}/values/${encodedRange}?key=${this.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
        console.log("-----> Response result", result);
      return {
        values: result.values || []
      };
    } catch (error: any) {
      console.error('Error reading Google Sheets data:', error.message);
      throw error;
    }
  }

  async updateData(spreadsheetId: string, range: string, values: Array<Array<string | number | boolean>>): Promise<{
    success: boolean;
    message: string;
    updatedCells?: number;
    requiresOAuth?: boolean;
  }> {
    try {
      // Clean spreadsheet ID (remove trailing slashes)
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const encodedRange = encodeURIComponent(range);
      const url = `${this.baseUrl}/${cleanSpreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED&key=${this.apiKey}`;
      
      const requestBody = {
        values: values
      };

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        
        // Check if it's the specific OAuth2 requirement error
        if (response.status === 401 && errorText.includes("API keys are not supported by this API")) {
          return {
            success: false,
            message: "Write operations require OAuth2 authentication. API keys can only read data.",
            requiresOAuth: true
          };
        }
        
        throw new Error(`API error ${response.status}: ${errorText}`);
      }
        
      const result = await response.json();
      console.log("-----> Update result", result);
      
      return {
        success: true,
        message: `Successfully updated ${result.updatedCells || 0} cells in range ${range}`,
        updatedCells: result.updatedCells || 0
      };
    } catch (error: any) {
      console.error('Error updating Google Sheets data:', error.message);
      return {
        success: false,
        message: `Update failed: ${error.message}`
      };
    }
  }

  async testConnection(spreadsheetId: string): Promise<{
    canRead: boolean;
    message: string;
    info?: any;
    troubleshooting?: string[];
  }> {
    try {
      // Validate API key format
      if (!this.apiKey || this.apiKey.length < 30) {
        return {
          canRead: false,
          message: "Invalid API key format",
          troubleshooting: [
            "API key should be around 39 characters long and start with 'AIza'",
            "Make sure you copied the full API key from Google Cloud Console"
          ]
        };
      }

      // Clean and validate spreadsheet ID
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, ''); // Remove trailing slashes
      
      if (!cleanSpreadsheetId || cleanSpreadsheetId.length < 20) {
        return {
          canRead: false,
          message: "Invalid spreadsheet ID format",
          troubleshooting: [
            "Spreadsheet ID should be extracted from the Google Sheets URL",
            "It's the long string between '/d/' and '/edit' in the URL",
            "Example: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
            "Make sure there are no trailing slashes or extra characters"
          ]
        };
      }

      // Try to get spreadsheet info
      const infoUrl = `${this.baseUrl}/${cleanSpreadsheetId}?key=${this.apiKey}`;
      console.log(`Attempting to access: ${infoUrl.replace(this.apiKey, 'API_KEY_HIDDEN')}`);
      
      const response = await fetch(infoUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        const troubleshooting = [];
        
        if (response.status === 403) {
          troubleshooting.push(
            "403 Permission Denied - This usually means:",
            "1. The spreadsheet is private and your API key can't access it",
            "2. Make sure the spreadsheet is publicly viewable (anyone with link can view)",
            "3. Or use OAuth2 instead of API key for private spreadsheets",
            "4. Verify your API key has Google Sheets API enabled in Google Cloud Console"
          );
        } else if (response.status === 400) {
          troubleshooting.push(
            "400 Bad Request - Check:",
            "1. Spreadsheet ID format is correct",
            "2. API key is valid and properly formatted"
          );
        } else if (response.status === 404) {
          troubleshooting.push(
            "404 Not Found - The spreadsheet doesn't exist or ID is incorrect"
          );
        }
        
        return {
          canRead: false,
          message: `Connection failed: ${response.status} ${errorText}`,
          troubleshooting
        };
      }

      const info = await response.json();
      
      return {
        canRead: true,
        message: "Connection successful",
        info: {
          title: info.properties?.title,
          sheets: info.sheets?.length || 0,
          spreadsheetId: info.spreadsheetId
        }
      };
    } catch (error: any) {
      return {
        canRead: false,
        message: `Connection failed: ${error.message}`,
        troubleshooting: [
          "Network error or invalid URL",
          "Check your internet connection",
          "Verify the Google Sheets API is accessible"
        ]
      };
    }
  }
}

export class GoogleSheetsServiceAccountService {
  private serviceAccountConfig: ServiceAccountConfig;
  private accessToken?: string;
  private tokenExpiry?: number;
  private baseUrl: string = 'https://sheets.googleapis.com/v4/spreadsheets';

  constructor(serviceAccountConfig: ServiceAccountConfig) {
    this.serviceAccountConfig = serviceAccountConfig;
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Generate JWT and exchange for access token
    try {
      const jwt = await this.createJWT();
      const tokenResponse = await fetch(this.serviceAccountConfig.token_uri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Service Account token request failed: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      this.accessToken = tokenData.access_token;
      this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
      
      if (!this.accessToken) {
        throw new Error('No access token received from Service Account authentication');
      }
      
      console.log("-----> Service Account token obtained successfully");
      return this.accessToken;
    } catch (error: any) {
      throw new Error(`Service Account authentication failed: ${error.message}`);
    }
  }

  private async createJWT(): Promise<string> {
    try {
      // Import crypto dynamically for ES modules
      const crypto = await import('crypto');
      
      // JWT Header
      const header = {
        alg: 'RS256',
        typ: 'JWT'
      };

      // JWT Payload
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.serviceAccountConfig.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: this.serviceAccountConfig.token_uri,
        exp: now + 3600, // 1 hour
        iat: now
      };

      // Encode header and payload
      const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
      const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
      const signatureInput = `${encodedHeader}.${encodedPayload}`;
      
      // Create signature using RS256
      const privateKey = this.serviceAccountConfig.private_key;
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signatureInput);
      const signature = sign.sign(privateKey, 'base64');
      const encodedSignature = signature
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      
      return `${signatureInput}.${encodedSignature}`;
    } catch (error: any) {
      throw new Error(`JWT creation failed: ${error.message}`);
    }
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  async readData(spreadsheetId: string, range: string): Promise<SheetData | null> {
    try {
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const encodedRange = encodeURIComponent(range);
      const accessToken = await this.getAccessToken();
      
      const url = `${this.baseUrl}/${cleanSpreadsheetId}/values/${encodedRange}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }
        
      const result = await response.json();
      console.log("-----> Service Account Read result", result);
      return {
        values: result.values || []
      };
    } catch (error: any) {
      console.error('Error reading Google Sheets data with Service Account:', error.message);
      throw error;
    }
  }

  async updateData(spreadsheetId: string, range: string, values: Array<Array<string | number | boolean>>): Promise<{
    success: boolean;
    message: string;
    updatedCells?: number;
  }> {
    try {
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const encodedRange = encodeURIComponent(range);
      const accessToken = await this.getAccessToken();
      
      const url = `${this.baseUrl}/${cleanSpreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`;
      
      const requestBody = {
        values: values
      };

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }
        
      const result = await response.json();
      console.log("-----> Service Account Update result", result);
      
      return {
        success: true,
        message: `Successfully updated ${result.updatedCells || 0} cells in range ${range}`,
        updatedCells: result.updatedCells || 0
      };
    } catch (error: any) {
      console.error('Error updating Google Sheets data with Service Account:', error.message);
      return {
        success: false,
        message: `Update failed: ${error.message}`
      };
    }
  }

  async testConnection(spreadsheetId: string): Promise<{
    canRead: boolean;
    message: string;
    info?: any;
    troubleshooting?: string[];
  }> {
    try {
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const accessToken = await this.getAccessToken();
      
      const url = `${this.baseUrl}/${cleanSpreadsheetId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return {
          canRead: false,
          message: `Service Account connection failed: ${response.status} ${errorText}`,
          troubleshooting: [
            "Service Account authentication failed",
            "Check if Service Account has access to the spreadsheet",
            "Make sure the spreadsheet is shared with the Service Account email",
            "Verify Service Account credentials are correct"
          ]
        };
      }

      const info = await response.json();
      
      return {
        canRead: true,
        message: "Service Account connection successful",
        info: {
          title: info.properties?.title,
          sheets: info.sheets?.length || 0,
          spreadsheetId: info.spreadsheetId
        }
      };
    } catch (error: any) {
      return {
        canRead: false,
        message: `Service Account connection failed: ${error.message}`,
        troubleshooting: [
          "Service Account authentication error",
          "Check Service Account configuration",
          "Verify JWT signing implementation"
        ]
      };
    }
  }
}

export class GoogleSheetsOAuth2Service {
  private oauth2Config: OAuth2Config;
  private accessToken?: string;
  private baseUrl: string = 'https://sheets.googleapis.com/v4/spreadsheets';

  constructor(oauth2Config: OAuth2Config, accessToken?: string) {
    this.oauth2Config = oauth2Config;
    this.accessToken = accessToken;
  }

  async getAccessToken(): Promise<string> {
    if (!this.accessToken) {
      throw new Error('No OAuth2 access token available. User must authorize first. Use generateAuthUrl() to start authorization flow.');
    }
    return this.accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  generateAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.oauth2Config.client_id,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent'
    });

    if (state) {
      params.append('state', state);
    }

    return `${this.oauth2Config.auth_uri}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuth2Tokens> {
    try {
      const tokenResponse = await fetch(this.oauth2Config.token_uri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.oauth2Config.client_id,
          client_secret: this.oauth2Config.client_secret,
          code: code,
          redirect_uri: redirectUri
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      
      const tokens: OAuth2Tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        scope: tokenData.scope,
        token_type: tokenData.token_type,
        expiry_date: tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : undefined
      };

      // Set the access token for immediate use
      this.accessToken = tokens.access_token;
      
      return tokens;
    } catch (error: any) {
      throw new Error(`OAuth2 token exchange failed: ${error.message}`);
    }
  }

  async readData(spreadsheetId: string, range: string): Promise<SheetData | null> {
    try {
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const encodedRange = encodeURIComponent(range);
      const accessToken = await this.getAccessToken();
      
      const url = `${this.baseUrl}/${cleanSpreadsheetId}/values/${encodedRange}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }
        
      const result = await response.json();
      console.log("-----> OAuth2 Read result", result);
      return {
        values: result.values || []
      };
    } catch (error: any) {
      console.error('Error reading Google Sheets data with OAuth2:', error.message);
      throw error;
    }
  }

  async updateData(spreadsheetId: string, range: string, values: Array<Array<string | number | boolean>>): Promise<{
    success: boolean;
    message: string;
    updatedCells?: number;
  }> {
    try {
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const encodedRange = encodeURIComponent(range);
      const accessToken = await this.getAccessToken();
      
      const url = `${this.baseUrl}/${cleanSpreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`;
      
      const requestBody = {
        values: values
      };

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }
        
      const result = await response.json();
      console.log("-----> OAuth2 Update result", result);
      
      return {
        success: true,
        message: `Successfully updated ${result.updatedCells || 0} cells in range ${range}`,
        updatedCells: result.updatedCells || 0
      };
    } catch (error: any) {
      console.error('Error updating Google Sheets data with OAuth2:', error.message);
      return {
        success: false,
        message: `Update failed: ${error.message}`
      };
    }
  }

  async testConnection(spreadsheetId: string): Promise<{
    canRead: boolean;
    message: string;
    info?: any;
    troubleshooting?: string[];
  }> {
    try {
      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, '');
      const accessToken = await this.getAccessToken();
      
      const url = `${this.baseUrl}/${cleanSpreadsheetId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return {
          canRead: false,
          message: `OAuth2 connection failed: ${response.status} ${errorText}`,
          troubleshooting: [
            "OAuth2 authentication failed",
            "Check if access token is valid and not expired",
            "Verify Google Sheets API is enabled for your project",
            "Ensure proper OAuth2 scopes are granted"
          ]
        };
      }

      const info = await response.json();
      
      return {
        canRead: true,
        message: "OAuth2 connection successful",
        info: {
          title: info.properties?.title,
          sheets: info.sheets?.length || 0,
          spreadsheetId: info.spreadsheetId
        }
      };
    } catch (error: any) {
      return {
        canRead: false,
        message: `OAuth2 connection failed: ${error.message}`,
        troubleshooting: [
          "OAuth2 authentication error",
          "User needs to authenticate first",
          "Check OAuth2 configuration"
        ]
      };
    }
  }
}

// Helper function to create OAuth2 service from JSON config
export function createOAuth2ServiceFromConfig(oauth2ConfigJson: string, accessToken?: string): GoogleSheetsOAuth2Service {
  try {
    console.log("-----> Parsing OAuth2 config JSON");
    console.log("-----> OAuth2 config length:", oauth2ConfigJson?.length || 0);
    
    const configObj = JSON.parse(oauth2ConfigJson);
    console.log("-----> Parsed config object keys:", Object.keys(configObj));
    
    const oauth2Config = configObj.web || configObj.installed;
    console.log("-----> OAuth2 config found:", !!oauth2Config);
    
    if (!oauth2Config) {
      throw new Error('Invalid OAuth2 config format. Expected "web" or "installed" key.');
    }
    
    console.log("-----> OAuth2 config keys:", Object.keys(oauth2Config));
    console.log("-----> Creating GoogleSheetsOAuth2Service");
    
    return new GoogleSheetsOAuth2Service(oauth2Config, accessToken);
  } catch (error: any) {
    console.error("-----> OAuth2 config parsing error:", error);
    throw new Error(`Failed to parse OAuth2 config: ${error.message}`);
  }
}

// Helper function to create Service Account service from JSON config
export function createServiceAccountServiceFromConfig(serviceAccountConfigJson: string): GoogleSheetsServiceAccountService {
  try {
    console.log("-----> Parsing Service Account config JSON");
    console.log("-----> Service Account config length:", serviceAccountConfigJson?.length || 0);
    
    const serviceAccountConfig = JSON.parse(serviceAccountConfigJson);
    console.log("-----> Parsed Service Account config type:", serviceAccountConfig.type);
    
    if (serviceAccountConfig.type !== 'service_account') {
      throw new Error('Invalid Service Account config format. Expected type "service_account".');
    }
    
    console.log("-----> Service Account email:", serviceAccountConfig.client_email);
    console.log("-----> Creating GoogleSheetsServiceAccountService");
    
    return new GoogleSheetsServiceAccountService(serviceAccountConfig);
  } catch (error: any) {
    console.error("-----> Service Account config parsing error:", error);
    throw new Error(`Failed to parse Service Account config: ${error.message}`);
  }
}

export function getGoogleSheetsService(apiKey?: string): GoogleSheetsService {
  return new GoogleSheetsService(apiKey);
}
