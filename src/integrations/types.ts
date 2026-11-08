/** Proveedores nativos con OAuth propio (no MCP). */
export type IntegrationId = 'linear' | 'github';

export interface IntegrationAccount {
  id: string;
  name: string;
  email?: string;
}

/** Token ya normalizado y listo para guardar en el vault cifrado. */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  /** epoch ms; ausente cuando el proveedor emite tokens sin expiración (GitHub). */
  expiresAt?: number;
  account?: IntegrationAccount;
  createdAt: number;
}

/** Respuesta cruda del endpoint token de un proveedor. */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string | string[];
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string | null;
}

export interface RefreshTokenInput {
  refreshToken: string;
  clientId: string;
  clientSecret: string | null;
}

export interface RevokeTokenInput {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  clientSecret: string | null;
}

export interface OAuthProvider {
  id: IntegrationId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Linear exige comas; GitHub usa espacios. */
  scopeSeparator: string;
  usesPkce: boolean;
  clientIdEnv: string;
  clientSecretEnv: string;
  requiresClientSecret: boolean;
  setupUrl: string;
  getClientId: () => string | null;
  getClientSecret: () => string | null;
  exchangeCode: (input: ExchangeCodeInput) => Promise<TokenResponse>;
  refreshToken: (input: RefreshTokenInput) => Promise<TokenResponse>;
  revokeToken: (input: RevokeTokenInput) => Promise<void>;
  fetchAccount: (accessToken: string) => Promise<IntegrationAccount>;
}

export interface IntegrationStatus {
  id: IntegrationId;
  label: string;
  configured: boolean;
  connected: boolean;
  account?: IntegrationAccount;
  expiresAt?: number;
  scopes: string[];
  redirectUri?: string;
  missingConfig?: string;
  clientIdEnv?: string;
  clientSecretEnv?: string;
  requiresClientSecret?: boolean;
  setupUrl?: string;
}
