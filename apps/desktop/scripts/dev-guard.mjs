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

// Call the locally-installed `tauri` CLI directly (bun puts node_modules/.bin
// on PATH when running package scripts, and child processes inherit it). This
// matches the dev:force/build:force scripts.
//
// Windows: the CLI is a `tauri.cmd` shim, which Node's spawn can only run via
// the shell. Passing an args array together with shell:true triggers DEP0190,
// so we hand the shell a single pre-joined command string instead.
// Unix: spawn the binary directly with an args array — no shell, no warning.
const isWindows = process.platform === 'win32'
const args = [subcommand, ...passthrough]
const spawnOptions = {
  cwd: resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
}
const child = isWindows
  ? spawn(['tauri', ...args].join(' '), { ...spawnOptions, shell: true })
  : spawn('tauri', args, spawnOptions)
child.on('error', (err) => {
  console.error(
    `[payroll-desktop] failed to run 'tauri ${subcommand}': ${err.message}\nMake sure dependencies are installed (run 'bun install' at the repo root).`
  )
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 0))
