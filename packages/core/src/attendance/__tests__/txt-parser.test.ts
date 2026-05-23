import { describe, expect, test } from 'bun:test'
import { groupPunchesByDay, parseBiometricTxt } from '../txt-parser'

describe('parseBiometricTxt', () => {
  test('parsea formato estándar ZKTeco (5 columnas tab-separated)', () => {
    const txt = [
      '1001\t2026-01-15\t08:00:00\t0\tREL-01',
      '1001\t2026-01-15\t12:00:00\t1\tREL-01',
      '1001\t2026-01-15\t13:00:00\t2\tREL-01',
      '1001\t2026-01-15\t17:00:00\t3\tREL-01',
    ].join('\n')

    const r = parseBiometricTxt(txt)
    expect(r.totalLines).toBe(4)
    expect(r.punches).toHaveLength(4)
    expect(r.errors).toHaveLength(0)
    expect(r.punches[0].employeeCode).toBe('1001')
    expect(r.punches[0].punchType).toBe(0)
    expect(r.punches[0].deviceCode).toBe('REL-01')
  })

  test('parsea formato con datetime combinado (3 columnas)', () => {
    const txt = '1001\t2026-01-15 08:00:00\t0\n1001\t2026-01-15 17:00:00\t3'
    const r = parseBiometricTxt(txt)
    expect(r.punches).toHaveLength(2)
    expect(r.punches[0].date).toBe('2026-01-15')
    expect(r.punches[0].time).toBe('08:00:00')
  })

  test('ignora líneas vacías y comentarios', () => {
    const txt = '# Archivo de marcaciones\n\n1001\t2026-01-15\t08:00\t0\n\n'
    const r = parseBiometricTxt(txt)
    expect(r.totalLines).toBe(1)
    expect(r.punches).toHaveLength(1)
  })

  test('reporta errores en líneas mal formateadas', () => {
    const txt = 'basura sin tabs\n1001\t2026-01-15\t08:00\t0'
    const r = parseBiometricTxt(txt)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].line).toBe(1)
    expect(r.punches).toHaveLength(1)
  })

  test('acepta HH:MM sin segundos', () => {
    const txt = '1001\t2026-01-15\t08:15\t0\tDEV1'
    const r = parseBiometricTxt(txt)
    expect(r.punches[0].time).toBe('08:15')
  })

  test('maneja CRLF de Windows', () => {
    const txt = '1001\t2026-01-15\t08:00:00\t0\r\n1001\t2026-01-15\t17:00:00\t3'
    const r = parseBiometricTxt(txt)
    expect(r.punches).toHaveLength(2)
  })
})

describe('groupPunchesByDay', () => {
  test('4 punches con tipos explícitos → jornada completa', () => {
    const { punches } = parseBiometricTxt(
      [
        '1001\t2026-01-15\t08:00\t0\tR1',
        '1001\t2026-01-15\t12:00\t1\tR1',
        '1001\t2026-01-15\t13:00\t2\tR1',
        '1001\t2026-01-15\t17:00\t3\tR1',
      ].join('\n')
    )

    const days = groupPunchesByDay(punches)
    expect(days).toHaveLength(1)
    expect(days[0].checkIn).toBe('08:00')
    expect(days[0].lunchStart).toBe('12:00')
    expect(days[0].lunchEnd).toBe('13:00')
    expect(days[0].checkOut).toBe('17:00')
    expect(days[0].punchCount).toBe(4)
  })

  test('todos tipo 0 (4 punches) → patrón in/lunch/lunch/out', () => {
    const { punches } = parseBiometricTxt(
      [
        'E01\t2026-01-15\t07:55\t0',
        'E01\t2026-01-15\t12:05\t0',
        'E01\t2026-01-15\t12:58\t0',
        'E01\t2026-01-15\t17:02\t0',
      ].join('\n')
    )

    const days = groupPunchesByDay(punches)
    expect(days[0].checkIn).toBe('07:55')
    expect(days[0].lunchStart).toBe('12:05')
    expect(days[0].lunchEnd).toBe('12:58')
    expect(days[0].checkOut).toBe('17:02')
  })

  test('solo 2 punches tipo 0 → in/out', () => {
    const { punches } = parseBiometricTxt('E01\t2026-01-15\t08:00\t0\nE01\t2026-01-15\t17:00\t0')
    const days = groupPunchesByDay(punches)
    expect(days[0].checkIn).toBe('08:00')
    expect(days[0].checkOut).toBe('17:00')
    expect(days[0].lunchStart).toBeNull()
  })

  test('múltiples empleados y días se agrupan correctamente', () => {
    const { punches } = parseBiometricTxt(
      [
        'E01\t2026-01-15\t08:00\t0',
        'E02\t2026-01-15\t08:05\t0',
        'E01\t2026-01-15\t17:00\t3',
        'E02\t2026-01-15\t17:10\t3',
        'E01\t2026-01-16\t08:00\t0',
        'E01\t2026-01-16\t17:00\t3',
      ].join('\n')
    )

    const days = groupPunchesByDay(punches)
    expect(days).toHaveLength(3)
    expect(days.filter((d) => d.employeeCode === 'E01')).toHaveLength(2)
    expect(days.filter((d) => d.employeeCode === 'E02')).toHaveLength(1)
  })

  test('ordena por fecha y luego por código de empleado', () => {
    const { punches } = parseBiometricTxt(
      ['B\t2026-01-16\t08:00\t0', 'A\t2026-01-15\t08:00\t0'].join('\n')
    )
    const days = groupPunchesByDay(punches)
    expect(days[0].date).toBe('2026-01-15')
    expect(days[0].employeeCode).toBe('A')
    expect(days[1].date).toBe('2026-01-16')
  })
})
