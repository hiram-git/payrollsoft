#!/usr/bin/env node
// Builds a distributable .msi with the cloud URL baked into the binary, so
// team members just install and run — no .env required on their machine.
//
// Usage:
//   bun --filter @payroll/desktop build:dist -- --url=https://payroll.example.com
//   bun --filter @payroll/desktop build:dist -- --url=https://host --mode=kiosk
//
// The URL can also come from the PAYROLL_DESKTOP_URL env var. The baked values
// are read at compile time via option_env! in src/lib.rs; runtime .env still
// overrides them for dev / IT.

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function arg(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

const url = arg('url') ?? process.env.PAYROLL_DESKTOP_URL
if (!url) {
  console.error(
    '[payroll-desktop] missing cloud URL.\n' +
      '  Usage: bun --filter @payroll/desktop build:dist -- --url=https://your-cloud-host'
  )
  process.exit(1)
}

try {
  // Validate early so a typo fails before a multi-minute compile.
  new URL(url)
} catch {
  console.error(`[payroll-desktop] not a valid URL: ${url}`)
  process.exit(1)
}

const mode = arg('mode') ?? process.env.PAYROLL_DESKTOP_MODE ?? ''

const env = {
  ...process.env,
  PAYROLL_DESKTOP_URL: url,
  PAYROLL_DESKTOP_ENABLED: 'true',
  PAYROLL_DESKTOP_MODE: mode,
}

console.log(
  `[payroll-desktop] baking URL=${url}${mode ? ` MODE=${mode}` : ''} and building installer…`
)

const spawnOptions = { cwd: resolve(__dirname, '..'), stdio: 'inherit', env }
const child =
  process.platform === 'win32'
    ? spawn('tauri build', { ...spawnOptions, shell: true })
    : spawn('tauri', ['build'], spawnOptions)

child.on('error', (err) => {
  console.error(
    `[payroll-desktop] failed to run 'tauri build': ${err.message}\nMake sure Rust and dependencies are installed (run 'bun install' and see apps/desktop/README.md).`
  )
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 0))
