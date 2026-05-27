/**
 * Parser de archivos TXT de relojes biométricos.
 *
 * Soporta el formato más común en equipos ZKTeco / Anviz / BioStar
 * usados en Panamá y LATAM:
 *
 *   {employeeCode}\t{YYYY-MM-DD}\t{HH:MM:SS}\t{punchType}\t{deviceCode}
 *
 * Donde punchType es:
 *   0 = Entrada (check-in o regreso de almuerzo)
 *   1 = Salida almuerzo
 *   2 = Regreso almuerzo
 *   3 = Salida (check-out)
 *
 * Algunos relojes combinan fecha+hora en una sola columna:
 *   {employeeCode}\t{YYYY-MM-DD HH:MM:SS}\t{punchType}
 *
 * El parser intenta ambos formatos y elige el que matchea.
 *
 * Después de parsear, `groupPunchesByDay` agrupa los punches por
 * (employeeCode, date) y determina checkIn/checkOut/lunchStart/
 * lunchEnd basándose en el orden cronológico y los tipos de punch.
 */

export type RawPunch = {
  lineNumber: number
  employeeCode: string
  date: string
  time: string
  punchType: number
  deviceCode: string | null
  raw: string
}

export type DaySummary = {
  employeeCode: string
  date: string
  checkIn: string | null
  checkOut: string | null
  lunchStart: string | null
  lunchEnd: string | null
  punchCount: number
  rawPunches: RawPunch[]
}

export type ParseResult = {
  punches: RawPunch[]
  errors: Array<{ line: number; raw: string; error: string }>
  totalLines: number
}

const TAB = '\t'
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/

/**
 * Parsea el contenido crudo del TXT. Acepta \r\n o \n como fin de
 * línea. Las líneas vacías y las que empiezan con # se ignoran.
 */
export function parseBiometricTxt(content: string): ParseResult {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const punches: RawPunch[] = []
  const errors: ParseResult['errors'] = []
  let totalLines = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (raw === '' || raw.startsWith('#')) continue
    totalLines++
    const lineNumber = i + 1

    const parts = raw.split(TAB)

    let employeeCode: string
    let date: string
    let time: string
    let punchType: number
    let deviceCode: string | null = null

    if (parts.length >= 4 && DATE_RE.test(parts[1]) && TIME_RE.test(parts[2])) {
      employeeCode = parts[0].trim()
      date = parts[1].trim()
      time = parts[2].trim()
      punchType = Number.parseInt(parts[3].trim(), 10)
      deviceCode = parts[4]?.trim() || null
    } else if (parts.length >= 3) {
      const dtMatch = parts[1]?.match(DATETIME_RE)
      if (dtMatch) {
        employeeCode = parts[0].trim()
        date = dtMatch[1]
        time = dtMatch[2]
        punchType = Number.parseInt(parts[2].trim(), 10)
        deviceCode = parts[3]?.trim() || null
      } else {
        errors.push({ line: lineNumber, raw, error: 'Formato no reconocido.' })
        continue
      }
    } else {
      errors.push({
        line: lineNumber,
        raw,
        error: 'Pocas columnas (se esperan al menos 3 separadas por TAB).',
      })
      continue
    }

    if (!employeeCode) {
      errors.push({ line: lineNumber, raw, error: 'Código de empleado vacío.' })
      continue
    }
    if (!DATE_RE.test(date)) {
      errors.push({ line: lineNumber, raw, error: `Fecha inválida: "${date}".` })
      continue
    }
    if (!Number.isFinite(punchType) || punchType < 0 || punchType > 9) {
      errors.push({ line: lineNumber, raw, error: `Tipo de punch inválido: "${parts[3] ?? '?'}".` })
      continue
    }

    punches.push({ lineNumber, employeeCode, date, time, punchType, deviceCode, raw })
  }

  return { punches, errors, totalLines }
}

/**
 * Agrupa punches por (employeeCode, date) y determina los campos
 * de la jornada (checkIn, checkOut, lunchStart, lunchEnd) basándose
 * en los tipos de punch y el orden cronológico.
 *
 * Lógica de tipos:
 *   0 → Entrada: si es el primer punch del día → checkIn;
 *                si lunchStart ya existe → lunchEnd
 *   1 → Salida almuerzo → lunchStart
 *   2 → Regreso almuerzo → lunchEnd
 *   3 → Salida → checkOut
 *
 * Si no hay tipos explícitos (todos son 0), el parser asume el
 * patrón más común: 1er punch = checkIn, 2do = lunchStart,
 * 3ro = lunchEnd, 4to = checkOut.
 */
export function groupPunchesByDay(punches: RawPunch[]): DaySummary[] {
  const groups = new Map<string, RawPunch[]>()

  for (const p of punches) {
    const key = `${p.employeeCode}|${p.date}`
    const arr = groups.get(key) ?? []
    arr.push(p)
    groups.set(key, arr)
  }

  const summaries: DaySummary[] = []

  for (const [key, dayPunches] of groups) {
    const [employeeCode, date] = key.split('|')
    const sorted = dayPunches.sort((a, b) => a.time.localeCompare(b.time))

    let checkIn: string | null = null
    let checkOut: string | null = null
    let lunchStart: string | null = null
    let lunchEnd: string | null = null

    const allZeros = sorted.every((p) => p.punchType === 0)

    if (allZeros && sorted.length >= 2) {
      checkIn = sorted[0].time
      if (sorted.length === 2) {
        checkOut = sorted[1].time
      } else if (sorted.length === 3) {
        lunchStart = sorted[1].time
        checkOut = sorted[2].time
      } else {
        lunchStart = sorted[1].time
        lunchEnd = sorted[2].time
        checkOut = sorted[sorted.length - 1].time
      }
    } else {
      for (const p of sorted) {
        switch (p.punchType) {
          case 0:
            if (!checkIn) checkIn = p.time
            else if (lunchStart && !lunchEnd) lunchEnd = p.time
            break
          case 1:
            lunchStart = p.time
            break
          case 2:
            lunchEnd = p.time
            break
          case 3:
            checkOut = p.time
            break
          default:
            if (!checkIn) checkIn = p.time
            else checkOut = p.time
        }
      }
    }

    summaries.push({
      employeeCode,
      date,
      checkIn,
      checkOut,
      lunchStart,
      lunchEnd,
      punchCount: sorted.length,
      rawPunches: sorted,
    })
  }

  return summaries.sort((a, b) => {
    const dc = a.date.localeCompare(b.date)
    if (dc !== 0) return dc
    return a.employeeCode.localeCompare(b.employeeCode)
  })
}
