/**
 * Storage en disco para adjuntos de expedientes.
 *
 * Layout:
 *   ${STORAGE_DIR}/${tenant}_storage/employee_files/employee_{employeeId}/
 *
 * STORAGE_DIR es configurable por env (default /tmp/payrollsoft-storage,
 * mismo default que el driver local de reportes para mantener un único
 * volumen). El nombre del archivo se sanea para evitar path traversal.
 */
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../../config/env'

const STORAGE_DIR =
  process.env.STORAGE_DIR ?? env.STORAGE_DIR ?? path.join('/tmp', 'payrollsoft-storage')

export const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
export const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif'])

function sanitiseFilename(name: string): string {
  const ext = path.extname(name)
  const stem = path.basename(name, ext).replace(/[^a-zA-Z0-9._-]+/g, '_')
  const safeExt = ext.replace(/[^a-zA-Z0-9.]+/g, '')
  const truncatedStem = stem.slice(0, 100 - safeExt.length)
  return truncatedStem + safeExt
}

export function employeeFilesDir(tenantSlug: string, employeeId: string): string {
  return path.join(STORAGE_DIR, `${tenantSlug}_storage`, 'employee_files', `employee_${employeeId}`)
}

export function buildRelativePath(
  tenantSlug: string,
  employeeId: string,
  originalName: string
): { relative: string; absolute: string; storedName: string } {
  const safe = sanitiseFilename(originalName)
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const storedName = `${stamp}_${safe}`
  const relative = path.posix.join(
    `${tenantSlug}_storage`,
    'employee_files',
    `employee_${employeeId}`,
    storedName
  )
  const absolute = path.join(STORAGE_DIR, relative)
  return { relative, absolute, storedName }
}

export async function writeAttachment(
  absolutePath: string,
  bytes: Uint8Array | Buffer
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, bytes)
}

export async function readAttachment(relativePath: string): Promise<Uint8Array | null> {
  const safe = path.posix.normalize(relativePath).replace(/^\/+/, '')
  if (safe.startsWith('..') || safe.includes('/../')) {
    throw new Error('employee-files storage: relative path inválido')
  }
  const absolute = path.join(STORAGE_DIR, safe)
  try {
    const s = await stat(absolute)
    if (!s.isFile()) return null
    const buf = await readFile(absolute)
    return new Uint8Array(buf)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw err
  }
}

export async function deleteAttachment(relativePath: string): Promise<void> {
  const safe = path.posix.normalize(relativePath).replace(/^\/+/, '')
  if (safe.startsWith('..') || safe.includes('/../')) return
  const absolute = path.join(STORAGE_DIR, safe)
  try {
    await unlink(absolute)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw err
  }
}
