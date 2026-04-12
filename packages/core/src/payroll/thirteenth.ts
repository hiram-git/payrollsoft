/**
 * XIII Mes (Décimo Tercer Mes) — Panamá
 *
 * Panama's thirteenth month bonus is equivalent to one month's salary per year,
 * paid in three four-month installments:
 *
 *   Period 1: Dec 16 → Apr 15  (payment in April)
 *   Period 2: Apr 16 → Aug 15  (payment in August)
 *   Period 3: Aug 16 → Dec 15  (payment in December)
 *
 * Each installment = accumulated_salaries_in_period / 4
 * Proportional if the employee worked fewer than 122 days in the period.
 */

export type ThirteenthPeriodNumber = 1 | 2 | 3

export type ThirteenthPeriod = {
  periodo: ThirteenthPeriodNumber
  año: number
  fechaInicio: string // YYYY-MM-DD
  fechaFin: string // YYYY-MM-DD
  descripcion: string
  tipoPago: 'TRIMESTRAL_1' | 'TRIMESTRAL_2' | 'TRIMESTRAL_3'
}

/**
 * Determine the XIII mes four-month period for a given liquidation/payment date.
 * Port of PHP `determinarPeriodoTrimestral()`.
 */
export function determinarPeriodoTrimestral(fechaLiquidacion: string | Date): ThirteenthPeriod {
  const fecha = new Date(fechaLiquidacion)
  const mes = fecha.getMonth() + 1 // 1–12
  const dia = fecha.getDate()
  const año = fecha.getFullYear()

  // ── Período 1: Dec 16 → Apr 15 ──────────────────────────────────────────────
  const enPeriodo1 =
    (mes === 12 && dia >= 16) || mes === 1 || mes === 2 || mes === 3 || (mes === 4 && dia <= 15)

  if (enPeriodo1) {
    if (mes === 12 && dia >= 16) {
      // December 16–31: beginning of a new period spanning into next year
      return {
        periodo: 1,
        año: año + 1,
        fechaInicio: `${año}-12-16`,
        fechaFin: `${año + 1}-04-15`,
        descripcion: `Período 1: Dic ${año} - Abr ${año + 1}`,
        tipoPago: 'TRIMESTRAL_1',
      }
    }
    // Jan – Apr 15: continuation of a period that started in previous December
    return {
      periodo: 1,
      año,
      fechaInicio: `${año - 1}-12-16`,
      fechaFin: `${año}-04-15`,
      descripcion: `Período 1: Dic ${año - 1} - Abr ${año}`,
      tipoPago: 'TRIMESTRAL_1',
    }
  }

  // ── Período 2: Apr 16 → Aug 15 ───────────────────────────────────────────────
  const enPeriodo2 =
    (mes === 4 && dia >= 16) || mes === 5 || mes === 6 || mes === 7 || (mes === 8 && dia <= 15)

  if (enPeriodo2) {
    return {
      periodo: 2,
      año,
      fechaInicio: `${año}-04-16`,
      fechaFin: `${año}-08-15`,
      descripcion: `Período 2: Abr ${año} - Ago ${año}`,
      tipoPago: 'TRIMESTRAL_2',
    }
  }

  // ── Período 3: Aug 16 → Dec 15 ───────────────────────────────────────────────
  return {
    periodo: 3,
    año,
    fechaInicio: `${año}-08-16`,
    fechaFin: `${año}-12-15`,
    descripcion: `Período 3: Ago ${año} - Dic ${año}`,
    tipoPago: 'TRIMESTRAL_3',
  }
}

/** All three XIII mes periods for a given year. */
export function getThirteenthPeriods(año: number): ThirteenthPeriod[] {
  return [
    {
      periodo: 1,
      año,
      fechaInicio: `${año - 1}-12-16`,
      fechaFin: `${año}-04-15`,
      descripcion: `Período 1: Dic ${año - 1} - Abr ${año}`,
      tipoPago: 'TRIMESTRAL_1',
    },
    {
      periodo: 2,
      año,
      fechaInicio: `${año}-04-16`,
      fechaFin: `${año}-08-15`,
      descripcion: `Período 2: Abr ${año} - Ago ${año}`,
      tipoPago: 'TRIMESTRAL_2',
    },
    {
      periodo: 3,
      año,
      fechaInicio: `${año}-08-16`,
      fechaFin: `${año}-12-15`,
      descripcion: `Período 3: Ago ${año} - Dic ${año}`,
      tipoPago: 'TRIMESTRAL_3',
    },
  ]
}

/**
 * Calculate effective days worked in the XIII mes period for a given employee.
 *
 * Rule:
 *   - If hired on or before period start → full period days
 *   - If hired during the period → days from hire date to period end (inclusive)
 *   - If hired after period end → 0 days
 *
 * @param hireDate  The employee's hire date
 * @param periodStart Period start date string (YYYY-MM-DD)
 * @param periodEnd   Period end date string (YYYY-MM-DD)
 */
export function calcThirteenthDaysWorked(
  hireDate: Date,
  periodStart: string,
  periodEnd: string
): number {
  const start = new Date(periodStart)
  const end = new Date(periodEnd)
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1

  if (hireDate <= start) return totalDays
  if (hireDate > end) return 0
  return Math.round((end.getTime() - hireDate.getTime()) / 86_400_000) + 1
}

/**
 * Apply the XIII mes proportionality rule.
 *
 * If diasTrabajados >= 122: no reduction (factor = 1)
 * If diasTrabajados < 122:  factor = diasTrabajados / 122
 */
export function thirteenthProportionFactor(diasTrabajados: number): number {
  const MIN_DAYS = 122
  if (diasTrabajados >= MIN_DAYS) return 1
  return Math.max(0, diasTrabajados / MIN_DAYS)
}
