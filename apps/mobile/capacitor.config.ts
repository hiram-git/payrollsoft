import type { CapacitorConfig } from '@capacitor/cli'

// Configuración de Capacitor. `webDir` apunta al bundle de Vite.
// El `server.androidScheme` mantiene el origin en https para que el
// WebView trate la app como contexto seguro (necesario para cámara).
const config: CapacitorConfig = {
  appId: 'com.payrollsoft.marcaciones',
  appName: 'PayrollSoft Marcaciones',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Camera: {},
  },
}

export default config
