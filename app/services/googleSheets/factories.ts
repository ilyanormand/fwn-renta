// Factory functions for creating Google Sheets services

import { GoogleSheetsService } from "./services/ApiKeyService";
import { GoogleSheetsServiceAccountService } from "./services/ServiceAccountService";
import { GoogleSheetsOAuth2Service } from "./services/OAuth2Service";
import type { OAuth2Config, ServiceAccountConfig } from "./types";

export function getGoogleSheetsService(apiKey?: string): GoogleSheetsService {
  return new GoogleSheetsService(apiKey);
}

export function createServiceAccountServiceFromConfig(
  serviceAccountConfigJson: string
): GoogleSheetsServiceAccountService {
  try {
    const serviceAccountConfig = JSON.parse(serviceAccountConfigJson);

    if (serviceAccountConfig.type !== "service_account") {
      throw new Error(
        'Invalid Service Account config format. Expected type "service_account".'
      );
    }

    return new GoogleSheetsServiceAccountService(serviceAccountConfig);
  } catch (error: any) {
    throw new Error(`Failed to parse Service Account config: ${error.message}`);
  }
}

export function createOAuth2ServiceFromConfig(
  oauth2ConfigJson: string,
  accessToken?: string
): GoogleSheetsOAuth2Service {
  try {
    const configObj = JSON.parse(oauth2ConfigJson);
    const oauth2Config = configObj.web || configObj.installed;

    if (!oauth2Config) {
      throw new Error(
        'Invalid OAuth2 config format. Expected "web" or "installed" key.'
      );
    }

    return new GoogleSheetsOAuth2Service(oauth2Config, accessToken);
  } catch (error: any) {
    throw new Error(`Failed to parse OAuth2 config: ${error.message}`);
  }
}
