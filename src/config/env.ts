import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  TOKEN_STORE_PATH: z.string().default('data/tokens.json'),
  DRIVE_ROOT_FOLDER_ID: z.string().optional().transform((value) => value?.trim() || undefined),
  REPORT_FORMAT_DEFAULT: z.enum(['pdf', 'gdoc']).default('pdf'),
  LOG_LEVEL: z.string().default('info')
});

export const env = envSchema.parse(process.env);
