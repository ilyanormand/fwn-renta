// Base class for Google Sheets services with common functionality

import type { SheetData, IGoogleSheetsService } from "../types";
import { cleanSpreadsheetId, buildReadUrl, buildUpdateUrl } from "../utils";

export abstract class BaseGoogleSheetsService implements IGoogleSheetsService {
  protected readonly baseUrl = "https://sheets.googleapis.com/v4/spreadsheets";

  protected abstract getAuthHeaders(): Promise<Record<string, string>>;
  protected abstract getQueryParams(): Record<string, string> | undefined;

  async readData(
    spreadsheetId: string,
    range: string
  ): Promise<SheetData | null> {
    try {
      const url = buildReadUrl(
        this.baseUrl,
        spreadsheetId,
        range,
        this.getQueryParams()
      );

      const headers = await this.getAuthHeaders();
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      return {
        values: result.values || [],
      };
    } catch (error: any) {
      console.error("Error reading Google Sheets data:", error.message);
      throw error;
    }
  }

  async updateData(
    spreadsheetId: string,
    range: string,
    values: Array<Array<string | number | boolean>>
  ): Promise<{
    success: boolean;
    message: string;
    updatedCells?: number;
    requiresOAuth?: boolean;
  }> {
    try {
      const url = buildUpdateUrl(this.baseUrl, spreadsheetId, range);
      const headers = await this.getAuthHeaders();

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Check if it's the specific OAuth2 requirement error
        if (
          response.status === 401 &&
          errorText.includes("API keys are not supported by this API")
        ) {
          return {
            success: false,
            message:
              "Write operations require OAuth2 authentication. API keys can only read data.",
            requiresOAuth: true,
          };
        }

        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      return {
        success: true,
        message: `Successfully updated ${result.updatedCells || 0} cells in range ${range}`,
        updatedCells: result.updatedCells || 0,
      };
    } catch (error: any) {
      console.error("Error updating Google Sheets data:", error.message);
      return {
        success: false,
        message: `Update failed: ${error.message}`,
      };
    }
  }

  async batchUpdate(
    spreadsheetId: string,
    updates: Array<{
      range: string;
      values: Array<Array<string | number | boolean>>;
    }>
  ): Promise<{
    success: boolean;
    message: string;
    updatedCells?: number;
    requiresOAuth?: boolean;
  }> {
    try {
      if (!updates || updates.length === 0) {
        return {
          success: true,
          message: "No updates to perform",
          updatedCells: 0,
        };
      }

      const cleanId = cleanSpreadsheetId(spreadsheetId);
      const url = `${this.baseUrl}/${cleanId}/values:batchUpdate`;
      const headers = await this.getAuthHeaders();

      // Prepare batch update request body
      const data = updates.map((update) => ({
        range: update.range,
        values: update.values,
      }));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: data,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Check if it's the specific OAuth2 requirement error
        if (
          response.status === 401 &&
          errorText.includes("API keys are not supported by this API")
        ) {
          return {
            success: false,
            message:
              "Write operations require OAuth2 authentication. API keys can only read data.",
            requiresOAuth: true,
          };
        }

        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      // Google Sheets API v4 batchUpdate returns totalUpdatedCells directly
      const totalUpdatedCells = result.totalUpdatedCells || 0;

      return {
        success: true,
        message: `Successfully updated ${updates.length} ranges with ${totalUpdatedCells} total cells`,
        updatedCells: totalUpdatedCells,
      };
    } catch (error: any) {
      console.error("Error batch updating Google Sheets data:", error.message);
      return {
        success: false,
        message: `Batch update failed: ${error.message}`,
      };
    }
  }
}
