#!/usr/bin/env node
// Gate for tauri dev/build commands: skip the Tauri shell unless
// DESKTOP_ENABLED is truthy in the root .env. Keeps the rest of the
// monorepo (web/api builds, CI without Rust toolchain) unaffected when
// desktop isn't in play.
//
// Usage: node scripts/dev-guard.mjs <tauri-subcommand> [...args]
//   node scripts/dev-guard.mjs dev
//   node scripts/dev-guard.mjs build

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const subcommand = process.argv[2] ?? 'dev'
const passthrough = process.argv.slice(3)

function findRootEnv(start) {
  let cursor = start
  while (true) {
    const candidate = resolve(cursor, '.env')
    if (existsSync(candidate)) return candidate
    const parent = resolve(cursor, '..')
    if (parent === cursor) return null
    cursor = parent
  }
}

function readEnvFlag(name) {
  if (process.env[name] !== undefined) return process.env[name]
  const envPath = findRootEnv(resolve(__dirname, '..'))
  if (!envPath) return undefined
  const body = readFileSync(envPath, 'utf8')
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (match && match[1] === name) {
      return match[2].replace(/^['"]|['"]$/g, '')
    }
  }
  return undefined
}

const raw = readEnvFlag('DESKTOP_ENABLED') ?? ''
const enabled = ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())

if (!enabled) {
  console.log(`[payroll-desktop] DESKTOP_ENABLED is not truthy — skipping 'tauri ${subcommand}'.`)
  process.exit(0)
}

const child = spawn('bunx', ['tauri', subcommand, ...passthrough], {
  cwd: resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
