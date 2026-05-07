import type { Auth } from 'googleapis';
import { env } from '../config/env.js';
import { tokenStore, type StoredTokens } from '../storage/tokenStore.js';
import { createGoogleOAuthClient } from './googleClient.js';

//* Contem a logica de Autenticacao via OAuth2 para acessar as APIs do Google, como Chat e Drive.


export const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly'
];

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive'
];

export const PEOPLE_SCOPES = [
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/directory.readonly'
];

export const ALL_SCOPES = [...CHAT_SCOPES, ...DRIVE_SCOPES, ...PEOPLE_SCOPES];

function getMissingScopes(scopeList?: string | null): string[] {
  if (!scopeList) return ALL_SCOPES;
  const granted = new Set(scopeList.split(/\s+/).filter(Boolean));
  return ALL_SCOPES.filter((scope) => !granted.has(scope));
}

// Converte StoredTokens (que aceita `null` por compatibilidade com o que o
// Google as vezes devolve) para o formato Auth.Credentials esperado pelo
// OAuth2Client (string | undefined). Mantemos a tipagem completa em vez do
// antigo cast `any`.
function toCredentials(tokens: StoredTokens): Auth.Credentials {
  const credentials: Auth.Credentials = {};
  if (tokens.access_token != null) credentials.access_token = tokens.access_token;
  if (tokens.refresh_token != null) credentials.refresh_token = tokens.refresh_token;
  if (tokens.scope != null) credentials.scope = tokens.scope;
  if (tokens.token_type != null) credentials.token_type = tokens.token_type;
  if (tokens.expiry_date != null) credentials.expiry_date = tokens.expiry_date;
  return credentials;
}

export function createOAuthClient(): Auth.OAuth2Client {
  return createGoogleOAuthClient(env.GOOGLE_REDIRECT_URI);
}

export function getAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ALL_SCOPES
  });
}

export async function setTokensFromCode(code: string): Promise<void> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens) {
    throw new Error('Falha ao obter tokens da API do Google');
  }

  const existing = await tokenStore.getTokens();
  await tokenStore.setTokens({
    ...tokens,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token
  });
}

export async function getAuthorizedClient(): Promise<Auth.OAuth2Client> {
  const client = createOAuthClient();
  const tokens = await tokenStore.getTokens();
  if (!tokens) {
    throw new Error('Tokens not found. Authorize via /auth/url first.');
  }
  const missingScopes = getMissingScopes(tokens.scope);
  if (missingScopes.length > 0) {
    throw new Error(
      `Tokens sem os escopos necessarios. Reautorize via /auth/url. ` +
      `Escopos faltando: ${missingScopes.join(', ')}`
    );
  }
  client.setCredentials(toCredentials(tokens));
  await client.getAccessToken();

  const mergedTokens: StoredTokens = {
    ...tokens,
    ...client.credentials,
    refresh_token: client.credentials.refresh_token ?? tokens.refresh_token
  };
  await tokenStore.setTokens(mergedTokens);
  return client;
}
