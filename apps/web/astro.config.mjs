import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import node from '@astrojs/node'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import { defineConfig } from 'astro/config'

function loadLocalHttps() {
  if (!process.env.HTTPS_LOCAL) return undefined
  const certDir = resolve(import.meta.dirname, '../../.certs')
  const key = resolve(certDir, 'local.key')
  const cert = resolve(certDir, 'local.crt')
  if (!existsSync(key) || !existsSync(cert)) {
    console.warn('[HTTPS_LOCAL] Certificados no encontrados. Ejecuta: ./scripts/local-https.sh')
    return undefined
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

const httpsConfig = loadLocalHttps()

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), tailwind()],
  security: {
    checkOrigin: false,
  },
  server: {
    port: Number(process.env.PORT) || 4321,
    host: process.env.HOST || '0.0.0.0',
  },
  vite: {
    server: {
      allowedHosts: true,
      https: httpsConfig,
    },
  },
})
