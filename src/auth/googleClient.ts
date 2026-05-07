import { google, type Auth } from 'googleapis';
import { env } from '../config/env.js';

// Fabrica unica de OAuth2Client. Usada tanto pelo fluxo do robo (drive/chat)
// quanto pelo Google Sign-In humano. O que diferencia os dois e somente o
// `redirectUri` e os escopos pedidos a frente.
export function createGoogleOAuthClient(redirectUri: string): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}
