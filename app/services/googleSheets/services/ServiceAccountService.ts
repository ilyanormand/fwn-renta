// Google Sheets service using Service Account authentication

import { BaseGoogleSheetsService } from "../base/BaseGoogleSheetsService";
import type { ServiceAccountConfig } from "../types";

export class GoogleSheetsServiceAccountService extends BaseGoogleSheetsService {
  private serviceAccountConfig: ServiceAccountConfig;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(serviceAccountConfig: ServiceAccountConfig) {
    super();
    this.serviceAccountConfig = serviceAccountConfig;
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.getAccessToken();
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  protected getQueryParams(): Record<string, string> | undefined {
    return undefined;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const jwt = await this.createJWT();
      const tokenResponse = await fetch(this.serviceAccountConfig.token_uri, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(
          `Service Account token request failed: ${tokenResponse.status} - ${errorText}`
        );
      }

      const tokenData = await tokenResponse.json();
      this.accessToken = tokenData.access_token;
      this.tokenExpiry = Date.now() + tokenData.expires_in * 1000;

      if (!this.accessToken) {
        throw new Error(
          "No access token received from Service Account authentication"
        );
      }

      return this.accessToken;
    } catch (error: any) {
      throw new Error(
        `Service Account authentication failed: ${error.message}`
      );
    }
  }

  private async createJWT(): Promise<string> {
    try {
      const crypto = await import("crypto");

      const header = {
        alg: "RS256",
        typ: "JWT",
      };

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.serviceAccountConfig.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: this.serviceAccountConfig.token_uri,
        exp: now + 3600,
        iat: now,
      };

      const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
      const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
      const signatureInput = `${encodedHeader}.${encodedPayload}`;

      const privateKey = this.serviceAccountConfig.private_key;
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(signatureInput);
      const signature = sign.sign(privateKey, "base64");
      const encodedSignature = signature
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      return `${signatureInput}.${encodedSignature}`;
    } catch (error: any) {
      throw new Error(`JWT creation failed: ${error.message}`);
    }
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
}
