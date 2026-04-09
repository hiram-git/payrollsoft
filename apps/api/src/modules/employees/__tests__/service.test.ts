import { describe, expect, it } from 'bun:test'
import { createEmployeeService, deactivateEmployeeService, updateEmployeeService } from '../service'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseEmployee = {
  id: 'emp-1',
  code: 'E001',
  firstName: 'Juan',
  lastName: 'Pérez',
  idNumber: '8-123-456',
  socialSecurityNumber: null,
  email: null,
  phone: null,
  position: 'Developer',
  department: 'IT',
  hireDate: '2024-01-15',
  baseSalary: '1200.00',
  payFrequency: 'biweekly',
  isActive: true,
  terminationDate: null,
  customFields: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

/** Builds a mock DB that returns `rows` for any select call */
function mockDb(rows: unknown[] = []) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([rows[0]]) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([rows[0]]) }) }),
    }),
  }
}

// ─── createEmployeeService ────────────────────────────────────────────────────

describe('createEmployeeService', () => {
  it('returns code_taken when code already exists', async () => {
    const db = mockDb([baseEmployee])
    const result = await createEmployeeService(db, {
      code: 'E001',
      firstName: 'Ana',
      lastName: 'López',
      idNumber: '4-555-666',
      hireDate: '2024-01-01',
      baseSalary: '900.00',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('code_taken')
    }
  })

  it('creates employee when code is unique', async () => {
    // First select (getEmployeeByCode) returns nothing; insert returns new employee
    const newEmployee = { ...baseEmployee, code: 'E002', id: 'emp-2' }
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([newEmployee]) }) }),
    }
    const result = await createEmployeeService(db, {
      code: 'E002',
      firstName: 'Ana',
      lastName: 'López',
      idNumber: '4-555-666',
      hireDate: '2024-01-01',
      baseSalary: '900.00',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.code).toBe('E002')
    }
  })

  it('uppercases the code', async () => {
    let insertedCode = ''
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({
        values: (data: { code: string }) => {
          insertedCode = data.code
          return { returning: () => Promise.resolve([{ ...baseEmployee, code: data.code }]) }
        },
      }),
    }
    await createEmployeeService(db, {
      code: 'e003',
      firstName: 'Carlos',
      lastName: 'Ruiz',
      idNumber: '5-111-222',
      hireDate: '2024-01-01',
      baseSalary: '1000.00',
    })
    expect(insertedCode).toBe('E003')
  })
})

// ─── updateEmployeeService ────────────────────────────────────────────────────

describe('updateEmployeeService', () => {
  it('returns not_found for unknown ID', async () => {
    const db = mockDb([])
    const result = await updateEmployeeService(db, 'nonexistent', { firstName: 'Nuevo' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('not_found')
    }
  })

  it('returns code_taken when new code is in use by another employee', async () => {
    let callCount = 0
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            // First call: getEmployee by ID → returns existing
            // Second call: getEmployeeByCode → returns another employee with same code
            callCount++
            return Promise.resolve(
              callCount === 1 ? [baseEmployee] : [{ ...baseEmployee, id: 'emp-99' }]
            )
          },
        }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([baseEmployee]) }) }),
      }),
    }
    const result = await updateEmployeeService(db, 'emp-1', { code: 'TAKEN' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('code_taken')
    }
  })

  it('succeeds with valid update', async () => {
    const updated = { ...baseEmployee, firstName: 'Juan Carlos' }
    let callCount = 0
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            callCount++
            return Promise.resolve(callCount === 1 ? [baseEmployee] : [])
          },
        }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([updated]) }) }),
      }),
    }
    const result = await updateEmployeeService(db, 'emp-1', { firstName: 'Juan Carlos' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data?.firstName).toBe('Juan Carlos')
    }
  })
})

// ─── deactivateEmployeeService ────────────────────────────────────────────────

describe('deactivateEmployeeService', () => {
  it('returns not_found for unknown ID', async () => {
    const db = mockDb([])
    const result = await deactivateEmployeeService(db, 'nonexistent')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('not_found')
  })

  it('returns already_inactive when employee is already inactive', async () => {
    const db = mockDb([{ ...baseEmployee, isActive: false }])
    const result = await deactivateEmployeeService(db, 'emp-1')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('already_inactive')
  })

  it('deactivates an active employee', async () => {
    const deactivated = { ...baseEmployee, isActive: false }
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([baseEmployee]) }) }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([deactivated]) }) }),
      }),
    }
    const result = await deactivateEmployeeService(db, 'emp-1')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data?.isActive).toBe(false)
  })
})
