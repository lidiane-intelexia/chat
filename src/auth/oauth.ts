import { google } from 'googleapis';
import { env } from '../config/env.js';
import { tokenStore } from '../storage/tokenStore.js';

export const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly'
];

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
];

export const ALL_SCOPES = [...CHAT_SCOPES, ...DRIVE_SCOPES];

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

export async function setTokensFromCode(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  await tokenStore.setTokens(tokens);
}

export async function getAuthorizedClient() {
  const client = createOAuthClient();
  const tokens = await tokenStore.getTokens();
  if (!tokens) {
    throw new Error('Tokens not found. Authorize via /auth/url first.');
  }
  client.setCredentials(tokens);
  return client;
}
