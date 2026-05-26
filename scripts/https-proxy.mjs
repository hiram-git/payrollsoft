import { existsSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
/**
 * Proxy HTTPS local para desarrollo.
 *
 * Envuelve el servidor HTTP de Astro (puerto 4321) con HTTPS en el
 * puerto 4322. La tablet se conecta a https://<IP>:4322 y la cámara
 * funciona porque getUserMedia requiere HTTPS.
 *
 * Uso:
 *   bun scripts/https-proxy.mjs          # o: node scripts/https-proxy.mjs
 *
 * Prerequisito:
 *   Ejecutar primero .\scripts\local-https.ps1 (o local-https.sh)
 *   para generar .certs/local.key y .certs/local.crt.
 */
import { createServer as createHttpsServer } from 'node:https'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const certDir = resolve(rootDir, '.certs')

const keyPath = resolve(certDir, 'local.key')
const certPath = resolve(certDir, 'local.crt')

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error('No se encontraron certificados en .certs/')
  console.error('Ejecuta primero:')
  console.error('  Windows:  .\\scripts\\local-https.ps1')
  console.error('  Linux:    ./scripts/local-https.sh')
  process.exit(1)
}

const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 4322
const TARGET_PORT = Number(process.env.PORT) || 4321
const TARGET_HOST = '127.0.0.1'

const server = createHttpsServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  (clientReq, clientRes) => {
    const proxyReq = httpRequest(
      {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: clientReq.url,
        method: clientReq.method,
        headers: {
          ...clientReq.headers,
          host: clientReq.headers.host,
        },
      },
      (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(clientRes, { end: true })
      }
    )

    proxyReq.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        clientRes.writeHead(502)
        clientRes.end(
          `El servidor de desarrollo no esta corriendo en el puerto ${TARGET_PORT}.\nArranca primero: bun run --filter @payroll/web dev`
        )
      } else {
        clientRes.writeHead(500)
        clientRes.end(`Error de proxy: ${err.message}`)
      }
    })

    clientReq.pipe(proxyReq, { end: true })
  }
)

server.listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log('')
  console.log('  HTTPS proxy activo')
  console.log(`  https://localhost:${HTTPS_PORT}  -->  http://localhost:${TARGET_PORT}`)
  console.log('')

  // Mostrar IPs locales
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  https://${net.address}:${HTTPS_PORT}  (${name})`)
      }
    }
  }

  console.log('')
  console.log('  En la tablet abre:')
  console.log(`  https://<TU-IP>:${HTTPS_PORT}/kiosk/setup`)
  console.log('')
  console.log('  Acepta la advertencia de certificado y listo.')
  console.log('')
})
