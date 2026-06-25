import { sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic db
type AnyDb = any

/**
 * Próximo código correlativo del sistema con prefijo: toma el mayor número
 * entre los códigos existentes con el formato `${prefix}NNNN`, le suma 1 y
 * lo devuelve con ceros a la izquierda (4 dígitos). Ej.: EMP0001, FUN0002.
 *
 * `table` es un identificador de tabla controlado por el código (no entrada
 * de usuario); se cita con `sql.identifier` de todos modos.
 */
export async function nextCorrelativeCode(
  db: AnyDb,
  table: string,
  prefix: string
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: rows
  const rows: any[] = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM ${`^${prefix}([0-9]+)$`}) AS bigint)), 0) AS maxnum
    FROM ${sql.identifier(table)}
    WHERE code ~ ${`^${prefix}[0-9]+$`}
  `)
  const maxnum = Number(rows?.[0]?.maxnum ?? 0)
  return `${prefix}${String(maxnum + 1).padStart(4, '0')}`
}
