import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  WEB_URL: z.string().url().default('http://localhost:4321'),
  // Absolute path to packages/db/drizzle/tenant. Required in bundled
  // deploys (Bun build rewrites import.meta.url so the in-package
  // default resolves to the wrong directory). In dev the source-tree
  // default works without this var.
  TENANT_MIGRATIONS_DIR: z.string().optional(),
  // Raíz de archivos persistidos en disco (reportes PDF en modo
  // `local_storage`, adjuntos de expedientes). Default `/tmp/...` para
  // que un clon recién bajado funcione sin setup.
  STORAGE_DIR: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export type Env = z.infer<typeof envSchema>
