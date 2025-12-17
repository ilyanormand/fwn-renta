// Type definitions for Google Sheets services

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

// Base interface for all Google Sheets services
export interface IGoogleSheetsService {
  readData(spreadsheetId: string, range: string): Promise<SheetData | null>;

  updateData(
    spreadsheetId: string,
    range: string,
    values: Array<Array<string | number | boolean>>
  ): Promise<{
    success: boolean;
    message: string;
    updatedCells?: number;
    requiresOAuth?: boolean;
  }>;
}
