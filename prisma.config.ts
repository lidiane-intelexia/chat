/// <reference types="node" />
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set (required by prisma.config.ts)');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url },
});
