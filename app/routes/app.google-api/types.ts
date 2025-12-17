// Типы для Google Sheets API управления

export interface GoogleAPISettings {
  oauth2Config?: string;
  oauth2Tokens?: string;
  serviceAccountConfig?: string;
  apiKey?: string;
  spreadsheetId?: string;
  lastUpdated?: string;
}

export interface TestResult {
  success: boolean;
  message: string;
  data?: any;
  serviceType?: string;
  troubleshooting?: string[];
  requiresAuth?: boolean;
  requiresOAuth?: boolean;
}

export interface ActionResponse {
  success?: boolean;
  error?: string;
  message?: string;
  data?: any;
  serviceType?: string;
  troubleshooting?: string[];
  requiresAuth?: boolean;
  requiresOAuth?: boolean;
}
