import { describe, expect, test } from 'bun:test'
import { consolidateDay } from '../consolidator'

const SHIFT = {
  entryTime: '08:00',
  exitTime: '17:00',
  lunchStartTime: '12:00',
  lunchEndTime: '13:00',
  entryToleranceAfter: 10,
  exitToleranceBefore: 10,
  weekdays: [1, 2, 3, 4, 5],
}

describe('consolidateDay', () => {
  test('present, no tardanza ni extra', () => {
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-21', // jueves
      shift: SHIFT,
      marcaciones: [
        { employeeId: 'e1', kind: 'entry', capturedAt: '2026-05-21T08:00:00' },
        { employeeId: 'e1', kind: 'lunch_start', capturedAt: '2026-05-21T12:00:00' },
        { employeeId: 'e1', kind: 'lunch_end', capturedAt: '2026-05-21T13:00:00' },
        { employeeId: 'e1', kind: 'exit', capturedAt: '2026-05-21T17:00:00' },
      ],
    })
    expect(r.status).toBe('present')
    expect(r.workedMinutes).toBe(8 * 60)
    expect(r.lateMinutes).toBe(0)
    expect(r.overtimeMinutes).toBe(0)
  })

  test('tardanza mayor a la tolerancia', () => {
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-21',
      shift: SHIFT,
      marcaciones: [
        { employeeId: 'e1', kind: 'entry', capturedAt: '2026-05-21T08:25:00' },
        { employeeId: 'e1', kind: 'exit', capturedAt: '2026-05-21T17:00:00' },
      ],
    })
    expect(r.status).toBe('late')
    expect(r.lateMinutes).toBe(15) // 25min - 10 toler.
  })

  test('horas extra (queda más allá de exit)', () => {
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-21',
      shift: SHIFT,
      marcaciones: [
        { employeeId: 'e1', kind: 'entry', capturedAt: '2026-05-21T08:00:00' },
        { employeeId: 'e1', kind: 'lunch_start', capturedAt: '2026-05-21T12:00:00' },
        { employeeId: 'e1', kind: 'lunch_end', capturedAt: '2026-05-21T13:00:00' },
        { employeeId: 'e1', kind: 'exit', capturedAt: '2026-05-21T19:00:00' },
      ],
    })
    expect(r.workedMinutes).toBe(10 * 60)
    expect(r.overtimeMinutes).toBe(2 * 60)
  })

  test('ausente cuando no hay marcaciones', () => {
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-21',
      shift: SHIFT,
      marcaciones: [],
    })
    expect(r.status).toBe('absent')
    expect(r.isAbsent).toBe(true)
    expect(r.workedMinutes).toBe(0)
  })

  test('día fuera del weekday del turno → descanso', () => {
    // 2026-05-23 es sábado
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-23',
      shift: SHIFT,
      marcaciones: [
        { employeeId: 'e1', kind: 'entry', capturedAt: '2026-05-23T08:00:00' },
        { employeeId: 'e1', kind: 'exit', capturedAt: '2026-05-23T12:00:00' },
      ],
    })
    expect(r.status).toBe('rest')
    expect(r.overtimeMinutes).toBe(4 * 60) // todo lo trabajado es extra
  })

  test('feriado del calendario laboral', () => {
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-21',
      shift: SHIFT,
      calendar: { date: '2026-05-21', isWorkday: false },
      marcaciones: [
        { employeeId: 'e1', kind: 'entry', capturedAt: '2026-05-21T08:00:00' },
        { employeeId: 'e1', kind: 'exit', capturedAt: '2026-05-21T17:00:00' },
      ],
    })
    expect(r.status).toBe('holiday')
    expect(r.isHoliday).toBe(true)
    expect(r.overtimeMinutes).toBe(9 * 60)
  })

  test('almuerzo excedido', () => {
    const r = consolidateDay({
      employeeId: 'e1',
      date: '2026-05-21',
      shift: SHIFT,
      marcaciones: [
        { employeeId: 'e1', kind: 'entry', capturedAt: '2026-05-21T08:00:00' },
        { employeeId: 'e1', kind: 'lunch_start', capturedAt: '2026-05-21T12:00:00' },
        { employeeId: 'e1', kind: 'lunch_end', capturedAt: '2026-05-21T13:30:00' },
        { employeeId: 'e1', kind: 'exit', capturedAt: '2026-05-21T17:00:00' },
      ],
    })
    expect(r.lunchOverMinutes).toBe(30)
  })
})
