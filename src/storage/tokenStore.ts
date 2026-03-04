import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

export interface StoredTokens {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
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
