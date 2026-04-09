// Attendance Processor — implemented in Phase 3
// Handles: marcaciones, tolerancias, horas extra, descuento almuerzo, Base44 webhook

export type AttendanceWebhookPayload = {
  employeeCode: string
  timestamp: string
  type: 'check_in' | 'check_out' | 'lunch_start' | 'lunch_end'
  deviceId?: string
}

// Stub — full implementation in Phase 3
export async function processAttendanceWebhook(_payload: AttendanceWebhookPayload): Promise<void> {
  throw new Error('AttendanceProcessor not yet implemented — coming in Phase 3')
}
