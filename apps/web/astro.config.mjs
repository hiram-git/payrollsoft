import node from '@astrojs/node'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import { defineConfig } from 'astro/config'

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), tailwind()],
  server: {
    port: Number(process.env.PORT) || 4321,
    host: process.env.HOST || '0.0.0.0',
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
})
