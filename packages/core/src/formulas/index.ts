// Formula Engine V3.5.3 — implemented in Phase 1
// Placeholder to satisfy exports during Phase 0

export type FormulaContext = {
  employee: Record<string, unknown>
  period: { start: Date; end: Date }
  concepts: Record<string, number>
  attendance: Record<string, unknown>
}

export type FormulaResult = {
  value: number
  error?: string
}

// Stub — full implementation in Phase 1
export function evaluateFormula(_formula: string, _context: FormulaContext): FormulaResult {
  throw new Error('FormulaEngine not yet implemented — coming in Phase 1')
}
