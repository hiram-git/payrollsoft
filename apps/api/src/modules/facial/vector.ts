/**
 * pgvector helpers — KNN search and embedding hygiene.
 *
 * Drizzle doesn't yet ship operator helpers for pgvector, so this file
 * encapsulates the raw SQL we need. Everything goes through `sql` from
 * drizzle-orm so values are parameterised safely.
 */
import { sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic db type
type AnyDb = any

export function toPgvectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Cosine-distance KNN against the active enrollments.
 *
 * Returns rows ordered by distance ascending. The HNSW index defined in
 * the migration uses `vector_cosine_ops` so this query is sublinear once
 * the dataset is non-trivial.
 */
export async function searchSimilarEmbeddings(
  db: AnyDb,
  embedding: number[],
  opts: { limit?: number; maxDistance?: number } = {}
): Promise<Array<{ enrollmentId: string; employeeId: string; distance: number }>> {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5))
  const literal = toPgvectorLiteral(embedding)
  const rows = (await db.execute(sql`
    SELECT
      id           AS enrollment_id,
      employee_id  AS employee_id,
      (embedding <=> ${literal}::vector) AS distance
      FROM facial_enrollments
     WHERE status = 'active'
       ${opts.maxDistance !== undefined ? sql`AND (embedding <=> ${literal}::vector) <= ${opts.maxDistance}` : sql``}
     ORDER BY embedding <=> ${literal}::vector
     LIMIT ${limit}
  `)) as unknown as Array<{
    enrollment_id: string
    employee_id: string
    distance: string | number
  }>

  return rows.map((r) => ({
    enrollmentId: r.enrollment_id,
    employeeId: r.employee_id,
    distance: typeof r.distance === 'string' ? Number.parseFloat(r.distance) : r.distance,
  }))
}

/**
 * Convert a cosine distance (0..2) into a percent-style confidence
 * score (0..1) for UI display. Embeddings from face-api are
 * unit-normalised so the practical range is 0..1; 0.4 is roughly the
 * "same person" threshold.
 */
export function distanceToConfidence(distance: number): number {
  // Map [0, 0.6] → [1, 0]. Above 0.6 we floor to 0.
  const clamped = Math.max(0, Math.min(0.6, distance))
  return 1 - clamped / 0.6
}

/** L2-normalise an embedding so cosine distance stays in [0,2]. */
export function normaliseEmbedding(embedding: number[]): number[] {
  let s = 0
  for (const v of embedding) s += v * v
  const n = Math.sqrt(s)
  if (n === 0) return embedding
  return embedding.map((v) => v / n)
}
