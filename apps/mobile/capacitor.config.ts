import type { CapacitorConfig } from '@capacitor/cli'

// Configuración de Capacitor. `webDir` apunta al bundle de Vite.
// El `server.androidScheme` mantiene el origin en https para que el
// WebView trate la app como contexto seguro (necesario para cámara).
//
// `cleartext: true` permite que el WebView haga requests a `http://`
// (API en LAN durante desarrollo). En producción la API debe servirse
// por `https://` y este flag puede quitarse.
const config: CapacitorConfig = {
  appId: 'com.payrollsoft.marcaciones',
  appName: 'PayrollSoft Marcaciones',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    Camera: {},
  },
}

export default config
