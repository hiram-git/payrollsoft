/**
 * Genera los assets fuente de marca (apps/mobile/assets/*) a partir del
 * isotipo oficial de RCG SOFTRIX (public/brand/rcg-mark.png).
 *
 * Produce lo que consume `@capacitor/assets generate`:
 *   - icon.png            (1024) isotipo sobre plato blanco redondeado
 *   - icon-foreground.png (1024) isotipo en zona segura (adaptive Android)
 *   - icon-background.png (1024) plato blanco sólido (adaptive Android)
 *   - splash.png          (2732) isotipo centrado sobre blanco
 *   - splash-dark.png     (2732) isotipo sobre fondo oscuro de marca
 *
 * Estos assets fuente SÍ se versionan; los PNG multiresolución finales
 * (android/.../res/**) los genera `bun run icons` y quedan en android/,
 * que está en .gitignore.
 *
 * Uso:  bun run scripts/gen-brand-assets.mjs
 */
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// sharp viene anidado en @capacitor/assets; se resuelve desde ahí.
const sharp = require(
  require.resolve('sharp', { paths: [require.resolve('@capacitor/assets/package.json')] })
)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARK = resolve(root, 'public/brand/rcg-mark.png')
const out = (f) => resolve(root, 'assets', f)

// ── icon.png (1024) — isotipo sobre plato blanco redondeado (estilo web) ──
const S = 1024
const pad = Math.round(S * 0.16)
const inner = S - pad * 2
const radius = Math.round(S * 0.18)
const roundedWhite = Buffer.from(
  `<svg width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`
)
const markInner = await sharp(MARK)
  .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .toBuffer()
await sharp(roundedWhite)
  .composite([{ input: markInner, top: pad, left: pad }])
  .png()
  .toFile(out('icon.png'))

// ── icon-foreground.png (adaptive) — isotipo en zona segura (~52%) ────────
const fgInner = Math.round(S * 0.52)
const fgPad = Math.round((S - fgInner) / 2)
const markFg = await sharp(MARK)
  .resize(fgInner, fgInner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer()
await sharp({
  create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: markFg, top: fgPad, left: fgPad }])
  .png()
  .toFile(out('icon-foreground.png'))

// ── icon-background.png (adaptive) — plato blanco sólido ──────────────────
await sharp({
  create: { width: S, height: S, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .png()
  .toFile(out('icon-background.png'))

// ── splash.png / splash-dark.png (2732) ───────────────────────────────────
const SP = 2732
const spMark = Math.round(SP * 0.22)
const spPad = Math.round((SP - spMark) / 2)
const markSp = await sharp(MARK)
  .resize(spMark, spMark, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .toBuffer()
await sharp({
  create: { width: SP, height: SP, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .composite([{ input: markSp, top: spPad, left: spPad }])
  .png()
  .toFile(out('splash.png'))
await sharp({
  create: { width: SP, height: SP, channels: 4, background: { r: 7, g: 16, b: 31, alpha: 1 } },
})
  .composite([{ input: markSp, top: spPad, left: spPad }])
  .png()
  .toFile(out('splash-dark.png'))

console.log('✓ assets de marca regenerados en apps/mobile/assets/')
