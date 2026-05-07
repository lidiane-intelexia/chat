import { env } from '../config/env.js';
import { createGoogleOAuthClient } from './googleClient.js';

const LOGIN_SCOPES = ['openid', 'email', 'profile'];

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  hd?: string;
  name?: string;
  picture?: string;
}

function createLoginClient() {
  return createGoogleOAuthClient(env.GOOGLE_LOGIN_REDIRECT_URI);
}

export function getLoginUrl(state: string): string {
  const client = createLoginClient();
  return client.generateAuthUrl({
    access_type: 'online',
    scope: LOGIN_SCOPES,
    prompt: 'select_account',
    state
  });
}

export async function verifyLoginCode(code: string): Promise<GoogleProfile> {
  const client = createLoginClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error('Resposta do Google sem id_token.');
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('id_token sem e-mail.');
  }
  return {
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    hd: payload.hd,
    name: payload.name,
    picture: payload.picture
  };
}
