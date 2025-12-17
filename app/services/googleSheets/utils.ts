// Utility functions for Google Sheets services

// Загрузка .env файла
export function loadDotEnvIfPresent(): void {
  try {
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
    // ignore
  }
}

// Clean spreadsheet ID (remove trailing slashes)
export function cleanSpreadsheetId(spreadsheetId: string): string {
  return spreadsheetId.trim().replace(/\/+$/, "");
}

// Build URL for reading data
export function buildReadUrl(
  baseUrl: string,
  spreadsheetId: string,
  range: string,
  queryParams?: Record<string, string>
): string {
  const cleanId = cleanSpreadsheetId(spreadsheetId);
  const encodedRange = encodeURIComponent(range);
  const url = `${baseUrl}/${cleanId}/values/${encodedRange}`;

  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    return `${url}?${params.toString()}`;
  }

  return url;
}

// Build URL for updating data
export function buildUpdateUrl(
  baseUrl: string,
  spreadsheetId: string,
  range: string
): string {
  const cleanId = cleanSpreadsheetId(spreadsheetId);
  const encodedRange = encodeURIComponent(range);
  return `${baseUrl}/${cleanId}/values/${encodedRange}?valueInputOption=USER_ENTERED`;
}
