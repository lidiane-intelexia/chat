import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

export interface StoredTokens {
  // Google returns `null` for some fields when they are not available. We
  // persist the raw values, so allow `null` in addition to `string`/`number`.
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
}  


const tokenPath = path.resolve(env.TOKEN_STORE_PATH);

async function ensureTokenDir() {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
}

export const tokenStore = {
  async getTokens(): Promise<StoredTokens | null> {
    try {
      const raw = await fs.readFile(tokenPath, 'utf-8');
      return JSON.parse(raw) as StoredTokens;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },

  async setTokens(tokens: StoredTokens): Promise<void> {
    await ensureTokenDir();
    await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');
  }
};
