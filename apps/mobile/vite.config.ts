import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El móvil corre como SPA. En `vite dev` sirve en :5173; el bundle de
// `vite build` (carpeta dist/) es lo que Capacitor empaqueta como webDir.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    port: 5173,
    host: true,
  },
})
