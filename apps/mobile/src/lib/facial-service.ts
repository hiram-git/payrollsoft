/**
 * Cliente de los endpoints /portal/facial/* (modo Empleado).
 *
 * El backend deriva el employeeId del JWT, así que ninguna llamada recibe
 * el empleado en el body. El cliente envía el embedding (128 floats) y el
 * backend decide el `kind` de la marca por la secuencia diaria.
 */
import { apiClient } from './api-client'

export type EnrollmentSummary = {
  id: string
  isPrimary: boolean
  enrolledAt: string
}

export type FacialMatchResult = {
  matched: boolean
  enrollmentId?: string
  distance?: number
  confidence?: number
  reason?: 'no_enrollment'
}

export type FacialMarcacionResult = {
  id: string
  kind: 'entry' | 'lunch_start' | 'lunch_end' | 'exit' | 'extra'
  deduped: boolean
}

export type FacialMarcacionInput = {
  embedding?: number[]
  photoUrl?: string
  confidence?: number
  matchDistance?: number
  livenessScore?: number
  capturedAt?: string
  idempotencyKey: string
  matchedEnrollmentId?: string
}

export const facialService = {
  async me(): Promise<{ hasEnrollment: boolean; enrollment: EnrollmentSummary | null }> {
    return apiClient.get('/portal/facial/me')
  },

  async enroll(input: {
    embedding: number[]
    photoUrl?: string
    qualityScore?: number
  }): Promise<EnrollmentSummary> {
    return apiClient.post('/portal/facial/enroll', input)
  },

  async match(embedding: number[]): Promise<FacialMatchResult> {
    return apiClient.post('/portal/facial/match', { embedding })
  },

  async record(input: FacialMarcacionInput): Promise<FacialMarcacionResult> {
    return apiClient.post('/portal/facial/marcaciones', input)
  },
}

/** Convierte el Float32Array que devuelve face-api en number[] serializable. */
export function descriptorToArray(descriptor: Float32Array): number[] {
  return Array.from(descriptor)
}

/** Genera una clave idempotente estable a partir del momento de captura. */
export function buildFacialIdempotencyKey(employeeId: string, capturedAt: Date): string {
  const ts = capturedAt
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
  const emp = (employeeId || 'anon').slice(0, 8)
  return `mobile-face:${emp}:${ts}`
}
