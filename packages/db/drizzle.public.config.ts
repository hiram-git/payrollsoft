import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/public-only.ts',
  out: './drizzle/public',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
