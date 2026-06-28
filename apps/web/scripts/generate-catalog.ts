#!/usr/bin/env bun
/**
 * Regenera las páginas de RRHH/Planilla y Asistencia con el contenido nuevo
 * (estilo del Catálogo de Software de RCG) y las empalma dentro del catálogo
 * original, reemplazando las páginas 5 y 6 (numeradas "4" y "5").
 *
 *   bun scripts/generate-catalog.ts <catalogo-original.pdf> [salida.pdf]
 *
 * Requiere poppler-utils (pdfseparate, pdfunite) en el PATH.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { CatalogPayrollPages } from '../src/lib/pdf/catalog-payroll-pdf'

const webRoot = resolve(import.meta.dir, '..')
const original = process.argv[2]
if (!original) {
  console.error('Uso: bun scripts/generate-catalog.ts <catalogo-original.pdf> [salida.pdf]')
  process.exit(1)
}
const originalPath = resolve(original)
const outPath = process.argv[3]
  ? resolve(process.argv[3])
  : join(webRoot, 'public/brochure/rcg-catalogo-software.pdf')
const pagesOnlyPath = join(webRoot, 'public/brochure/rcg-catalogo-paginas-payroll.pdf')

const logoPath = join(webRoot, 'public/brand/rcg-catalog-mark.png')
const logo = (await Bun.file(logoPath).exists()) ? logoPath : null

// 1. Render the two replacement pages.
const buffer = await renderToBuffer(
  CatalogPayrollPages({ logo }) as Parameters<typeof renderToBuffer>[0],
)
await mkdir(dirname(pagesOnlyPath), { recursive: true })
await Bun.write(pagesOnlyPath, buffer)
console.log(`✓ Páginas nuevas: ${pagesOnlyPath} (${(buffer.length / 1024).toFixed(1)} KB)`)

// 2. Splice into the original catalog (replace 1-indexed pages 5 and 6).
const work = await mkdtemp(join(tmpdir(), 'catalog-'))
try {
  // El catálogo original viene cifrado (permisos); pdfunite no fusiona PDFs
  // cifrados, así que primero lo desciframos con qpdf.
  const decrypted = join(work, 'orig-decrypted.pdf')
  const dec = Bun.spawn(['qpdf', '--decrypt', originalPath, decrypted])
  if ((await dec.exited) !== 0) throw new Error('qpdf --decrypt falló')

  const sep = async (src: string, prefix: string) => {
    const r = Bun.spawn(['pdfseparate', src, join(work, `${prefix}-%02d.pdf`)])
    if ((await r.exited) !== 0) throw new Error(`pdfseparate falló para ${src}`)
  }
  await sep(decrypted, 'orig')
  await sep(pagesOnlyPath, 'new')

  const order = [
    join(work, 'orig-01.pdf'),
    join(work, 'orig-02.pdf'),
    join(work, 'orig-03.pdf'),
    join(work, 'orig-04.pdf'),
    join(work, 'new-01.pdf'), // ← reemplaza orig-05 (RRHH/Planilla)
    join(work, 'new-02.pdf'), // ← reemplaza orig-06 (Asistencia)
    join(work, 'orig-07.pdf'),
    join(work, 'orig-08.pdf'),
    join(work, 'orig-09.pdf'),
    join(work, 'orig-10.pdf'),
    join(work, 'orig-11.pdf'),
    join(work, 'orig-12.pdf'),
  ]
  const merge = Bun.spawn(['pdfunite', ...order, outPath])
  if ((await merge.exited) !== 0) throw new Error('pdfunite falló')
  console.log(`✓ Catálogo actualizado: ${outPath}`)
} finally {
  await rm(work, { recursive: true, force: true })
}
