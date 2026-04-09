import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/tenant-only.ts',
  out: './drizzle/tenant',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
