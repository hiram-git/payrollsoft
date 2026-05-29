import { describe, expect, test } from 'bun:test'
import {
  ANNUAL_MINUTES,
  canDebit,
  computeAvailableMinutes,
  hoursToMinutes,
  minutesToHours,
  summarizeMovements,
} from '../calculation'

describe('summarizeMovements', () => {
  test('empty ledger is all zero', () => {
    expect(summarizeMovements([])).toEqual({
      creditedMinutes: 0,
      debitedMinutes: 0,
      availableMinutes: 0,
    })
  })

  test('initialization only', () => {
    const s = summarizeMovements([{ amountMinutes: ANNUAL_MINUTES }])
    expect(s.creditedMinutes).toBe(8640)
    expect(s.debitedMinutes).toBe(0)
    expect(s.availableMinutes).toBe(8640)
  })

  test('credits and debits net out', () => {
    const s = summarizeMovements([
      { amountMinutes: 8640 }, // init 144h
      { amountMinutes: -480 }, // absence 8h
      { amountMinutes: -120 }, // tardiness 2h
      { amountMinutes: 240 }, // overtime 4h
    ])
    expect(s.creditedMinutes).toBe(8640 + 240)
    expect(s.debitedMinutes).toBe(480 + 120)
    expect(s.availableMinutes).toBe(8640 + 240 - 480 - 120)
  })

  test('can go negative', () => {
    const s = summarizeMovements([{ amountMinutes: 60 }, { amountMinutes: -180 }])
    expect(s.availableMinutes).toBe(-120)
  })
})

describe('computeAvailableMinutes', () => {
  test('sums all amounts', () => {
    expect(computeAvailableMinutes([{ amountMinutes: 100 }, { amountMinutes: -40 }])).toBe(60)
  })
})

describe('canDebit', () => {
  test('rejects when insufficient and no override', () => {
    expect(canDebit(240, 480, false)).toBe(false)
  })

  test('allows when sufficient', () => {
    expect(canDebit(480, 480, false)).toBe(true)
  })

  test('allows going negative with override', () => {
    expect(canDebit(240, 480, true)).toBe(true)
  })

  test('rejects zero or negative requests', () => {
    expect(canDebit(1000, 0, false)).toBe(false)
    expect(canDebit(1000, -10, true)).toBe(false)
  })

  test('exact balance is allowed', () => {
    expect(canDebit(8640, 8640, false)).toBe(true)
  })
})

describe('hours <-> minutes', () => {
  test('hoursToMinutes', () => {
    expect(hoursToMinutes(144)).toBe(8640)
    expect(hoursToMinutes(1.5)).toBe(90)
  })

  test('minutesToHours rounds to 2 decimals', () => {
    expect(minutesToHours(8640)).toBe(144)
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(50)).toBe(0.83)
  })
})
