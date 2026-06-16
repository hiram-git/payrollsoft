import type { CapacitorConfig } from '@capacitor/cli'

// Configuración de Capacitor. `webDir` apunta al bundle de Vite.
//
// androidScheme:
//   - 'http'  → la app se carga desde http://localhost. Necesario en
//     DESARROLLO cuando la API va por http:// en la LAN: si la app se
//     cargara desde https://, el WebView bloquearía el fetch a http como
//     "mixed content" (TypeError: Failed to fetch), independientemente de
//     `cleartext`. http://localhost sigue siendo "secure context" en
//     Chromium, así que la cámara y demás APIs funcionan igual.
//   - 'https' → recomendado en PRODUCCIÓN, con la API también por https.
//
// cleartext: permite tráfico http:// a nivel de red Android (API en LAN).
const config: CapacitorConfig = {
  appId: 'com.payrollsoft.marcaciones',
  appName: 'RCG SOFTRIX Marcaciones',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    Camera: {},
  },
}

export default config
