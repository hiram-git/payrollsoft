import type { DeviceSummary, UnifiedPunch } from '@/types/domain'
/**
 * Llamadas de asistencia. La creación de punches NO vive aquí: pasa
 * siempre por la cola offline (`offline-queue.ts`) para no perder
 * marcaciones. Aquí solo van las lecturas.
 */
import { apiClient } from './api-client'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function listTodayPunches(employeeId?: string): Promise<UnifiedPunch[]> {
  return apiClient.get<UnifiedPunch[]>('/attendance/punches', {
    date: today(),
    employeeId,
    limit: 200,
  })
}

export async function listDevices(): Promise<DeviceSummary[]> {
  return apiClient.get<DeviceSummary[]>('/attendance/devices')
}
