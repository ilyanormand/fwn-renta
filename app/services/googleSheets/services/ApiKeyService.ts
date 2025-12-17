// Google Sheets service using API key authentication

import { BaseGoogleSheetsService } from "../base/BaseGoogleSheetsService";
import type { SheetData } from "../types";
import { loadDotEnvIfPresent } from "../utils";

loadDotEnvIfPresent();

export class GoogleSheetsService extends BaseGoogleSheetsService {
  private apiKey: string;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.GOOGLE_SHEETS_API_KEY || "";

    if (!this.apiKey && process.env.GOOGLE_OAUTH_CONFIG) {
      console.log(
        "ℹ️ No API key provided, OAuth config available but not supported in this simple service"
      );
      console.log("💡 For OAuth2 support, use the full OAuth service");
    }

    if (!this.apiKey) {
      throw new Error(
        "Google Sheets API key not found. Set GOOGLE_SHEETS_API_KEY environment variable."
      );
    }
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    return {};
  }

  protected getQueryParams(): Record<string, string> | undefined {
    return { key: this.apiKey };
  }

  async testConnection(spreadsheetId: string): Promise<{
    canRead: boolean;
    message: string;
    info?: any;
    troubleshooting?: string[];
  }> {
    try {
      if (!this.apiKey || this.apiKey.length < 30) {
        return {
          canRead: false,
          message: "Invalid API key format",
          troubleshooting: [
            "API key should be around 39 characters long and start with 'AIza'",
            "Make sure you copied the full API key from Google Cloud Console",
          ],
        };
      }

      const cleanSpreadsheetId = spreadsheetId.trim().replace(/\/+$/, "");

      if (!cleanSpreadsheetId || cleanSpreadsheetId.length < 20) {
        return {
          canRead: false,
          message: "Invalid spreadsheet ID format",
          troubleshooting: [
            "Spreadsheet ID should be extracted from the Google Sheets URL",
            "It's the long string between '/d/' and '/edit' in the URL",
            "Example: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
            "Make sure there are no trailing slashes or extra characters",
          ],
        };
      }

      const infoUrl = `${this.baseUrl}/${cleanSpreadsheetId}?key=${this.apiKey}`;
      console.log(
        `Attempting to access: ${infoUrl.replace(this.apiKey, "API_KEY_HIDDEN")}`
      );

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
          troubleshooting,
        };
      }

      const info = await response.json();

      return {
        canRead: true,
        message: "Connection successful",
        info: {
          title: info.properties?.title,
          sheets: info.sheets?.length || 0,
          spreadsheetId: info.spreadsheetId,
        },
      };
    } catch (error: any) {
      return {
        canRead: false,
        message: `Connection failed: ${error.message}`,
        troubleshooting: [
          "Network error or invalid URL",
          "Check your internet connection",
          "Verify the Google Sheets API is accessible",
        ],
      };
    }
  }
}
