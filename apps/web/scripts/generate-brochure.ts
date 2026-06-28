#!/usr/bin/env bun
/**
 * Genera el brochure ejecutivo de RCG SOFTRIX en PDF.
 *
 *   bun scripts/generate-brochure.ts [salida.pdf]   (desde apps/web)
 *
 * Por defecto escribe en apps/web/public/brochure/rcg-softrix-brochure.pdf
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { BrochurePdf } from '../src/lib/pdf/brochure-pdf'

const webRoot = resolve(import.meta.dir, '..')
const logoPath = join(webRoot, 'public/brand/rcg-mark-red.png')
const outPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(webRoot, 'public/brochure/rcg-softrix-brochure.pdf')

const logo = (await Bun.file(logoPath).exists()) ? logoPath : null
if (!logo) console.warn(`⚠  Logo no encontrado en ${logoPath} — se usará placeholder.`)

const element = BrochurePdf({ logo })
const buffer = await renderToBuffer(element as Parameters<typeof renderToBuffer>[0])

await mkdir(dirname(outPath), { recursive: true })
await Bun.write(outPath, buffer)

console.log(`✓ Brochure generado: ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
