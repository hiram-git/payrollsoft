import { facialEnrollments } from '@payroll/db'
/**
 * Embedding matching — cosine distance computed in application code.
 *
 * Embeddings are stored as jsonb arrays in PostgreSQL. For <1000
 * active enrollments this is fast enough (~1ms in JS). For larger
 * deployments, swap in pgvector with an HNSW index.
 */
import { eq } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic db type
type AnyDb = any

/**
 * Cosine distance between two unit-normalised vectors.
 * Range: [0, 2]. 0 = identical, 2 = opposite.
 */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return 1 - dot
}

/**
 * Search active enrollments by cosine distance against the given
 * embedding. Loads all active embeddings from the DB and computes
 * distance in JS — fast for <1000 rows (~256 KB of 128-dim vectors).
 */
export async function searchSimilarEmbeddings(
  db: AnyDb,
  embedding: number[],
  opts: { limit?: number; maxDistance?: number } = {}
): Promise<Array<{ enrollmentId: string; employeeId: string; distance: number }>> {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5))

  const rows = await db
    .select({
      id: facialEnrollments.id,
      employeeId: facialEnrollments.employeeId,
      embedding: facialEnrollments.embedding,
    })
    .from(facialEnrollments)
    .where(eq(facialEnrollments.status, 'active'))

  const scored = rows
    .map((r: { id: string; employeeId: string; embedding: number[] }) => ({
      enrollmentId: r.id,
      employeeId: r.employeeId,
      distance: cosineDistance(embedding, r.embedding),
    }))
    .filter((r) => (opts.maxDistance === undefined ? true : r.distance <= opts.maxDistance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)

  return scored
}

/**
 * Convert a cosine distance (0..2) into a percent-style confidence
 * score (0..1) for UI display. Embeddings from face-api are
 * unit-normalised so the practical range is 0..1; 0.4 is roughly the
 * "same person" threshold.
 */
export function distanceToConfidence(distance: number): number {
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
