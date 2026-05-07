import pino from 'pino';
import { env } from '../config/env.js';

//* Funcoes auxiliares.

// Caminhos sensiveis que NUNCA devem aparecer em log estruturado.
// Cobrimos:
//  - cabecalhos de requisicao (cookie e Authorization, em minusculo e mixed case)
//  - tokens do robo (`tokens.json`) caso sejam logados via objeto de erro
//  - id_token do Google Sign-In e qualquer access/refresh token serializado
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  'tokens.access_token',
  'tokens.refresh_token',
  'tokens.id_token'
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]'
  }
});
