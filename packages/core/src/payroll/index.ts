// Payroll Engine — implemented in Phase 3
// Handles: planillas, XIII Mes, acumulados, múltiples tipos de nómina

export type PayrollEngineConfig = {
  tenantSlug: string
  payrollId: string
}

// Stub — full implementation in Phase 3
export async function processPayroll(_config: PayrollEngineConfig): Promise<void> {
  throw new Error('PayrollEngine not yet implemented — coming in Phase 3')
}
