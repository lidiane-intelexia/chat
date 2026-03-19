import { google } from 'googleapis';
import { env } from '../config/env.js';
import { tokenStore } from '../storage/tokenStore.js';

//* Contém a lógica de Autenticação via OAuth2 para acessar as APIs do Google, como Chat e Drive.


export const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly'
];

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
];

export const PEOPLE_SCOPES = [
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/directory.readonly'
];

export const ALL_SCOPES = [...CHAT_SCOPES, ...DRIVE_SCOPES, ...PEOPLE_SCOPES];

function hasRequiredScopes(scopeList?: string | null) {
  if (!scopeList) return false;
  const granted = new Set(scopeList.split(/\s+/).filter(Boolean));
  return ALL_SCOPES.every((scope) => granted.has(scope));
}  


export function createOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
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

export async function getAuthorizedClient() {
  const client = createOAuthClient();
  const tokens = await tokenStore.getTokens();
  if (!tokens) {
    throw new Error('Tokens not found. Authorize via /auth/url first.');
  }
  if (!hasRequiredScopes(tokens.scope)) {
    throw new Error('Tokens missing required scopes. Reauthorize via /auth/url.');
  }
  // `tokens` may contain `null` values, which the google client doesn't expect
  // (it uses `string | undefined`). the easiest fix is to cast to `any` after
  // stripping out explicit nulls.
  const safeCredentials: any = { ...tokens };
  for (const key of Object.keys(safeCredentials)) {
    if (safeCredentials[key] === null) delete safeCredentials[key];
  }
  client.setCredentials(safeCredentials);
  await client.getAccessToken();

  const mergedTokens = {
    ...tokens,
    ...client.credentials,
    refresh_token: client.credentials.refresh_token ?? tokens.refresh_token
  };
  // the `StoredTokens` interface now permits null values, so this assignment
  // is safe without a cast. we still return the client for convenience.
  await tokenStore.setTokens(mergedTokens);
  return client;
}
