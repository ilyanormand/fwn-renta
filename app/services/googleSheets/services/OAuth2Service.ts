// Google Sheets service using OAuth2 authentication

import { BaseGoogleSheetsService } from "../base/BaseGoogleSheetsService";
import type { OAuth2Config, OAuth2Tokens } from "../types";

export class GoogleSheetsOAuth2Service extends BaseGoogleSheetsService {
  private oauth2Config: OAuth2Config;
  private accessToken?: string;

  constructor(oauth2Config: OAuth2Config, accessToken?: string) {
    super();
    this.oauth2Config = oauth2Config;
    this.accessToken = accessToken;
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

  async getAccessToken(): Promise<string> {
    if (!this.accessToken) {
      throw new Error(
        "No OAuth2 access token available. User must authorize first. Use generateAuthUrl() to start authorization flow."
      );
    }
    return this.accessToken;
  }

  generateAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.oauth2Config.client_id,
      redirect_uri: redirectUri,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
    });

    if (state) {
      params.append("state", state);
    }

    return `${this.oauth2Config.auth_uri}?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string
  ): Promise<OAuth2Tokens> {
    try {
      const tokenResponse = await fetch(this.oauth2Config.token_uri, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.oauth2Config.client_id,
          client_secret: this.oauth2Config.client_secret,
          code: code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(
          `Token exchange failed: ${tokenResponse.status} - ${errorText}`
        );
      }

      const tokenData = await tokenResponse.json();

      const tokens: OAuth2Tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        scope: tokenData.scope,
        token_type: tokenData.token_type,
        expiry_date: tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : undefined,
      };

      this.accessToken = tokens.access_token;

      return tokens;
    } catch (error: any) {
      throw new Error(`OAuth2 token exchange failed: ${error.message}`);
    }
  }
}
