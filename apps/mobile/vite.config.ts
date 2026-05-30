import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El móvil corre como SPA. En `vite dev` sirve en :5173; el bundle de
// `vite build` (carpeta dist/) es lo que Capacitor empaqueta como webDir.
//
// `base: './'` es CLAVE para Capacitor: genera rutas de assets relativas
// en index.html en vez de absolutas (`/assets/...`). En el WebView nativo
// (servido desde `https://localhost` o `capacitor://localhost`) las rutas
// absolutas con `crossorigin` pueden fallar al cargar el bundle y dejar la
// app en pantalla/arranque roto.
export default defineConfig({
  base: './',
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
