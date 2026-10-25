import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Load the repo-root .env so `pnpm db:migrate` / `db:generate` work without exporting variables first.
if (!process.env.DATABASE_URL && existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
