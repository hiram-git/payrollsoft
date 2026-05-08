import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ReportStorage, ReportStorageObject } from './types'

/**
 * Almacenamiento en disco local. Mismo contrato que el driver R2, pero
 * los objetos se persisten bajo `STORAGE_DIR/{key}`. Cada `key` ya viene
 * tenant-prefijado por el helper `payrollReportKey`, así que no hay
 * riesgo de cross-tenant aunque varios tenants compartan disco.
 *
 * Configurable vía `STORAGE_DIR` (variable de entorno, ruta absoluta);
 * si no está, usamos un subdirectorio del tmp del sistema para que un
 * clon recién bajado pueda generar reportes sin setup adicional.
 */
const STORAGE_DIR =
  import.meta.env.STORAGE_DIR ?? process.env.STORAGE_DIR ?? path.join('/tmp', 'payrollsoft-storage')

function resolvePath(key: string): string {
  // Defensa básica: prevenimos `../` saltos del directorio raíz. Las keys
  // canónicas (`reports/...`) ya están bajo nuestro control, pero por las
  // dudas normalizamos antes de tocar el disco.
  const normalised = path.posix.normalize(key).replace(/^\/+/, '')
  if (normalised.startsWith('..') || normalised.includes('/../')) {
    throw new Error(`local_storage: key inválida (${key})`)
  }
  return path.join(STORAGE_DIR, normalised)
}

export const localStorageDriver: ReportStorage = {
  driver: 'local',

  async put(input: ReportStorageObject): Promise<string> {
    const fullPath = resolvePath(input.key)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, input.bytes)
    return input.key
  },

  async get(key: string): Promise<Uint8Array | null> {
    const fullPath = resolvePath(key)
    try {
      const s = await stat(fullPath)
      if (!s.isFile()) return null
      const buf = await readFile(fullPath)
      return new Uint8Array(buf)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw err
    }
  },
}
