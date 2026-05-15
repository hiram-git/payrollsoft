#!/usr/bin/env node
// Guard for `bun dev` at the monorepo root: skip the Tauri shell unless
// DESKTOP_ENABLED is truthy in the root .env. Keeps `bun --filter='*' dev`
// fast for contributors who only work on the web/api.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
  console.log('[payroll-desktop] DESKTOP_ENABLED is not truthy — skipping tauri dev.')
  process.exit(0)
}

const child = spawn('bunx', ['tauri', 'dev'], {
  cwd: resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
