import { z } from 'zod';

//*Guarda as variáveis de ambiente (como  as chaves de API do Google) definidas no seu arquivo .env.

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  GOOGLE_LOGIN_REDIRECT_URI: z.string().url(),
  TOKEN_STORE_PATH: z.string().default('data/tokens.json'),
  REPORT_FORMAT_DEFAULT: z.enum(['pdf', 'gdoc']).default('pdf'),
  LOG_LEVEL: z.string().default('info'),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET deve ter ao menos 32 caracteres (gere com `openssl rand -hex 32`).'),
  ALLOWED_HD: z.string().min(1).default('grupodpg.com.br')
});

export const env = envSchema.parse(process.env);
