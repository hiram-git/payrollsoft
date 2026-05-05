// Cross-platform `prepare` hook that runs husky only when its binary
// is already linked under node_modules/.bin. The first install on a
// fresh checkout (Bun, npm, pnpm — all of them invoke `prepare` at
// different points in the lifecycle) doesn't have the binary yet, and
// running it prints a noisy "command not found" plus a non-zero exit
// on Windows. Subsequent installs find the binary and wire the hooks.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const binDir = join(here, '..', 'node_modules', '.bin')
const huskyBin = join(binDir, process.platform === 'win32' ? 'husky.cmd' : 'husky')

if (!existsSync(huskyBin)) {
  // First install — husky hooks will be installed the next time
  // `bun install` runs, after this binary is linked.
  process.exit(0)
}

const result = spawnSync(huskyBin, [], { stdio: 'inherit', shell: false })
process.exit(result.status ?? 0)
