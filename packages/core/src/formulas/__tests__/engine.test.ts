import { describe, expect, it } from 'bun:test'
import { FormulaEngine } from '../engine'
import type { FormulaContext } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<FormulaContext>): FormulaContext {
  return {
    employee: {
      baseSalary: 1200,
      hireDate: new Date('2020-01-01'),
      customFields: {},
    },
    period: {
      start: new Date('2026-04-01'),
      end: new Date('2026-04-15'),
      totalDays: 15,
      type: 'biweekly',
    },
    attendance: {
      workedDays: 13,
      businessDays: 10,
      lateMinutes: 30,
      overtimeMinutes: 120,
      absenceDays: 2,
    },
    concepts: {
      HORA_EXTRA: 60,
      PRESTAMO: 50,
    },
    loadAccumulated: async (code, periods) => {
      // Stub: return 500 * periods for any code
      return 500 * periods
    },
    loadBalance: async (type) => {
      if (type === 'PRESTAMO') return 250
      if (type === 'VACACIONES') return 10
      return 0
    },
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FormulaEngine', () => {
  const engine = new FormulaEngine()
  const ctx = makeCtx()

  // ── Arithmetic ──────────────────────────────────────────────────────────

  it('evaluates a constant number', async () => {
    const r = await engine.evaluate('100', ctx)
    expect(r).toEqual({ value: 100 })
  })

  it('evaluates addition', async () => {
    expect((await engine.evaluate('2 + 3', ctx)).value).toBe(5)
  })

  it('evaluates multiplication with correct precedence', async () => {
    expect((await engine.evaluate('2 + 3 * 4', ctx)).value).toBe(14)
  })

  it('evaluates parentheses', async () => {
    expect((await engine.evaluate('(2 + 3) * 4', ctx)).value).toBe(20)
  })

  it('evaluates unary negation', async () => {
    expect((await engine.evaluate('-5 + 10', ctx)).value).toBe(5)
  })

  it('evaluates division', async () => {
    expect((await engine.evaluate('100 / 4', ctx)).value).toBe(25)
  })

  it('returns error on division by zero', async () => {
    const r = await engine.evaluate('10 / 0', ctx)
    expect(r.value).toBe(0)
    expect(r.error).toContain('Division by zero')
  })

  // ── Variables ───────────────────────────────────────────────────────────

  it('resolves SALARIO variable', async () => {
    const r = await engine.evaluate('SALARIO', ctx)
    expect(r.value).toBe(1200)
  })

  it('resolves DIAS_TRABAJADOS variable', async () => {
    expect((await engine.evaluate('DIAS_TRABAJADOS', ctx)).value).toBe(13)
  })

  it('resolves HORAS_EXTRA variable (overtimeMinutes / 60)', async () => {
    expect((await engine.evaluate('HORAS_EXTRA', ctx)).value).toBe(2)
  })

  it('returns error for unknown variable', async () => {
    const r = await engine.evaluate('VARIABLE_INEXISTENTE', ctx)
    expect(r.value).toBe(0)
    expect(r.error).toContain('Unknown variable')
  })

  // ── Real payroll formulas ───────────────────────────────────────────────

  it('calculates daily salary', async () => {
    // Salario quincenal = salario mensual / 30 * 15
    const r = await engine.evaluate('SALARIO / 30 * DIAS("PERIODO")', ctx)
    expect(r.value).toBeCloseTo(600, 2) // 1200 / 30 * 15 = 600
  })

  it('calculates proportional salary by worked days', async () => {
    // 1200 / 15 * 13 = 1040
    const r = await engine.evaluate('SALARIO / DIAS_PERIODO * DIAS_TRABAJADOS', ctx)
    expect(r.value).toBeCloseTo(1040, 2)
  })

  it('calculates overtime with 25% surcharge', async () => {
    // (SALARIO / 200) * HORAS_EXTRA * 1.25
    const r = await engine.evaluate('(SALARIO / 200) * HORAS_EXTRA * 1.25', ctx)
    // (1200/200) * 2 * 1.25 = 6 * 2 * 1.25 = 15
    expect(r.value).toBeCloseTo(15, 2)
  })

  // ── SI() function ───────────────────────────────────────────────────────

  it('SI() returns true branch when condition != 0', async () => {
    const r = await engine.evaluate('SI(1, 100, 200)', ctx)
    expect(r.value).toBe(100)
  })

  it('SI() returns false branch when condition == 0', async () => {
    const r = await engine.evaluate('SI(0, 100, 200)', ctx)
    expect(r.value).toBe(200)
  })

  it('SI() with comparison condition', async () => {
    // SALARIO > 1000 → true → 500
    const r = await engine.evaluate('SI(SALARIO > 1000, 500, 0)', ctx)
    expect(r.value).toBe(500)
  })

  // ── CONCEPTO() ──────────────────────────────────────────────────────────

  it('CONCEPTO() returns concept value from context', async () => {
    const r = await engine.evaluate('CONCEPTO("HORA_EXTRA")', ctx)
    expect(r.value).toBe(60)
  })

  it('CONCEPTO() returns 0 for missing concept', async () => {
    const r = await engine.evaluate('CONCEPTO("INEXISTENTE")', ctx)
    expect(r.value).toBe(0)
  })

  it('CONCEPTO() is case-insensitive for the code', async () => {
    const r = await engine.evaluate('CONCEPTO("hora_extra")', ctx)
    expect(r.value).toBe(60)
  })

  // ── DIAS() ──────────────────────────────────────────────────────────────

  it('DIAS("TRABAJADOS") returns attendance worked days', async () => {
    expect((await engine.evaluate('DIAS("TRABAJADOS")', ctx)).value).toBe(13)
  })

  it('DIAS("PERIODO") returns total period days', async () => {
    expect((await engine.evaluate('DIAS("PERIODO")', ctx)).value).toBe(15)
  })

  it('DIAS() with unknown type returns error', async () => {
    const r = await engine.evaluate('DIAS("DESCONOCIDO")', ctx)
    expect(r.error).toContain('unknown type')
  })

  // ── INIPERIODO / FINPERIODO ─────────────────────────────────────────────

  it('INIPERIODO() returns day-of-month of period start', async () => {
    expect((await engine.evaluate('INIPERIODO()', ctx)).value).toBe(1) // April 1
  })

  it('FINPERIODO() returns day-of-month of period end', async () => {
    expect((await engine.evaluate('FINPERIODO()', ctx)).value).toBe(15) // April 15
  })

  it('MESPERIODO() returns month number', async () => {
    expect((await engine.evaluate('MESPERIODO()', ctx)).value).toBe(4) // April
  })

  // ── ACUMULADOS() ────────────────────────────────────────────────────────

  it('ACUMULADOS() calls loadAccumulated with correct args', async () => {
    // stub returns 500 * periods
    const r = await engine.evaluate('ACUMULADOS("INGRESO_BRUTO", 6)', ctx)
    expect(r.value).toBe(3000) // 500 * 6
  })

  // ── SALDO() ─────────────────────────────────────────────────────────────

  it('SALDO("PRESTAMO") calls loadBalance', async () => {
    const r = await engine.evaluate('SALDO("PRESTAMO")', ctx)
    expect(r.value).toBe(250)
  })

  it('SALDO("VACACIONES") returns vacation balance', async () => {
    const r = await engine.evaluate('SALDO("VACACIONES")', ctx)
    expect(r.value).toBe(10)
  })

  // ── Math helpers ────────────────────────────────────────────────────────

  it('REDONDEAR() rounds to 2 decimals by default', async () => {
    const r = await engine.evaluate('REDONDEAR(3.14159, 2)', ctx)
    expect(r.value).toBe(3.14)
  })

  it('ABS() returns absolute value', async () => {
    expect((await engine.evaluate('ABS(-50)', ctx)).value).toBe(50)
  })

  it('MAX() returns maximum', async () => {
    expect((await engine.evaluate('MAX(10, 20)', ctx)).value).toBe(20)
  })

  it('MIN() returns minimum', async () => {
    expect((await engine.evaluate('MIN(10, 20)', ctx)).value).toBe(10)
  })

  // ── Engine features ─────────────────────────────────────────────────────

  it('caches compiled ASTs', async () => {
    const formula = 'SALARIO + 100'
    await engine.evaluate(formula, ctx)
    await engine.evaluate(formula, ctx)
    expect(engine.cacheSize).toBeGreaterThan(0)
  })

  it('clearCache() empties the cache', async () => {
    await engine.evaluate('1 + 1', ctx)
    engine.clearCache()
    expect(engine.cacheSize).toBe(0)
  })

  // ── XIII Month formula ──────────────────────────────────────────────────

  it('calculates XIII month partial payment correctly', async () => {
    // XIII = ACUMULADOS("INGRESO_BRUTO", 6) / 6
    // stub: 500 * 6 / 6 = 500
    const r = await engine.evaluate('ACUMULADOS("INGRESO_BRUTO", 6) / 6', ctx)
    expect(r.value).toBe(500)
  })

  it('calculates XIII month with conditional', async () => {
    // SI(MESPERIODO() >= 7, ACUMULADOS("IB", 6) / 12, 0)
    // April (4) < 7 → 0
    const r = await engine.evaluate('SI(MESPERIODO() >= 7, ACUMULADOS("IB", 6) / 12, 0)', ctx)
    expect(r.value).toBe(0)
  })

  // ── Multi-line formulas with user-defined variables ──────────────────────

  it('evaluates a multi-line formula returning last statement value', async () => {
    const formula = 'base = SALARIO * 2\nmonto = base'
    // SALARIO = 1200 → base = 2400, monto = 2400
    const r = await engine.evaluate(formula, ctx)
    expect(r.value).toBe(2400)
  })

  it('user variable shadows context variable within formula scope', async () => {
    // Override SALARIO locally; should not affect the real ctx
    const formula = 'SALARIO = 9999\nmonto = SALARIO'
    const r = await engine.evaluate(formula, ctx)
    expect(r.value).toBe(9999)
    // Real context is unchanged
    expect((await engine.evaluate('SALARIO', ctx)).value).toBe(1200)
  })

  it('each formula evaluation gets an isolated scope', async () => {
    const f1 = 'x = 100\nmonto = x'
    // f2 references x which was only defined in f1's scope — must not leak
    const f2 = 'y = SALARIO\nmonto = x'
    await engine.evaluate(f1, ctx)
    const r2 = await engine.evaluate(f2, ctx)
    expect(r2.error).toContain("Unknown variable: 'X'")
  })

  it('multi-line formula supports SI() on user variable', async () => {
    const formula = [
      'base = SALARIO',
      'bonus = SI(base > 1000, base * 0.1, 0)',
      'monto = bonus',
    ].join('\n')
    // SALARIO = 1200 > 1000 → bonus = 120, monto = 120
    const r = await engine.evaluate(formula, ctx)
    expect(r.value).toBeCloseTo(120, 5)
  })

  it('evaluates the ISR formula correctly', async () => {
    // Payroll for an employee earning 3000/month (biweekly salary = 1500)
    const isrCtx = makeCtx({
      employee: {
        id: 'emp-isr',
        code: 'E001',
        baseSalary: 3000,
        hireDate: new Date('2020-01-01'),
        customFields: { gastos_rep: 0 },
      },
    })
    const formula = [
      'salario_anual = SALARIO*13',
      'gr_anual = GASTOS_REPRESENTACION*13',
      'neto_gravable = salario_anual',
      'saldo_gravable = neto_gravable-11000',
      'isr_anual = saldo_gravable * 0.15',
      'isr_mensual = isr_anual/13',
      'isr_quincenal = isr_mensual/2',
      'saldo_excedente = SI(salario_anual>50000, salario_anual-50000, 0)',
      'excendente_gravable = SI(saldo_excedente>0, saldo_excedente*0.25, 0)',
      'exceso_adicional = SI(excendente_gravable>0, excendente_gravable+5850, 0)',
      'exceso_anual = SI(exceso_adicional>0, exceso_adicional/13, 0)',
      'exceso_quincenal = SI(exceso_anual>0, exceso_anual/2, 0)',
      'monto = SI(saldo_excedente>0, exceso_quincenal, isr_quincenal)',
    ].join('\n')

    const r = await engine.evaluate(formula, isrCtx)
    // salario_anual = 3000*13 = 39000
    // saldo_gravable = 39000-11000 = 28000
    // isr_anual = 28000*0.15 = 4200
    // isr_mensual = 4200/13 ≈ 323.077
    // isr_quincenal ≈ 161.538
    // saldo_excedente = 0 (39000 < 50000)
    // monto = isr_quincenal ≈ 161.538
    expect(r.error).toBeUndefined()
    expect(r.value).toBeCloseTo(4200 / 13 / 2, 4)
  })

  it('evaluates ISR formula for high-income employee (exceso path)', async () => {
    const highCtx = makeCtx({
      employee: {
        id: 'emp-high',
        code: 'E002',
        baseSalary: 5000,
        hireDate: new Date('2020-01-01'),
        customFields: { gastos_rep: 0 },
      },
    })
    const formula = [
      'salario_anual = SALARIO*13',
      'gr_anual = GASTOS_REPRESENTACION*13',
      'neto_gravable = salario_anual',
      'saldo_gravable = neto_gravable-11000',
      'isr_anual = saldo_gravable * 0.15',
      'isr_mensual = isr_anual/13',
      'isr_quincenal = isr_mensual/2',
      'saldo_excedente = SI(salario_anual>50000, salario_anual-50000, 0)',
      'excendente_gravable = SI(saldo_excedente>0, saldo_excedente*0.25, 0)',
      'exceso_adicional = SI(excendente_gravable>0, excendente_gravable+5850, 0)',
      'exceso_anual = SI(exceso_adicional>0, exceso_adicional/13, 0)',
      'exceso_quincenal = SI(exceso_anual>0, exceso_anual/2, 0)',
      'monto = SI(saldo_excedente>0, exceso_quincenal, isr_quincenal)',
    ].join('\n')

    const r = await engine.evaluate(formula, highCtx)
    // salario_anual = 5000*13 = 65000
    // saldo_excedente = 65000-50000 = 15000
    // excendente_gravable = 15000*0.25 = 3750
    // exceso_adicional = 3750+5850 = 9600
    // exceso_anual = 9600/13 ≈ 738.46
    // exceso_quincenal ≈ 369.23
    // monto = exceso_quincenal (excedente path)
    expect(r.error).toBeUndefined()
    expect(r.value).toBeCloseTo((15000 * 0.25 + 5850) / 13 / 2, 4)
  })
})
