/**
 * Seed script — creates demo data for local development and Railway
 * Usage: bun --env-file ../../.env src/seed.ts   (local)
 *        bun src/seed.ts                          (Railway — DATABASE_URL injected)
 *
 * Requires migrations to have been applied first.
 * All inserts are idempotent (ON CONFLICT DO UPDATE / DO NOTHING).
 *
 * Creates:
 *  Public schema:
 *    - 1 super admin  (superadmin@payroll.dev / SuperAdmin123!)
 *    - 1 tenant       (slug: demo)
 *
 *  Tenant demo schema:
 *    - 1 usuario admin (admin@demo.com / Admin123!)
 *    - 1 función       (ADM - Administrativo)
 *    - 1 cargo         (EMP - Empleado General)
 *    - 2 departamentos (ADMIN → RRHH)
 *    - 1 horario       (Turno Regular 8-5)
 *    - 1 acreedor      (BN - Banco Nacional) + su concepto vinculado
 *    - 5 conceptos de nómina (SUELDO, SS, SE, SSP, SEP)
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const SUPER_ADMIN_EMAIL = 'superadmin@payroll.dev'
const SUPER_ADMIN_PASSWORD = 'SuperAdmin123!'
const SUPER_ADMIN_NAME = 'Super Admin'

const TENANT_SLUG = 'demo'
const TENANT_NAME = 'Demo Company'

const USER_EMAIL = 'admin@demo.com'
const USER_PASSWORD = 'Admin123!'
const USER_NAME = 'Demo Admin'

const superAdminHash = await Bun.password.hash(SUPER_ADMIN_PASSWORD, {
  algorithm: 'bcrypt',
  cost: 12,
})
const userHash = await Bun.password.hash(USER_PASSWORD, { algorithm: 'bcrypt', cost: 12 })

const publicSql = postgres(url, {
  prepare: false,
  connection: { search_path: 'payroll_auth,public' },
})
const tenantSql = postgres(url, {
  prepare: false,
  connection: { search_path: `tenant_${TENANT_SLUG},payroll_auth,public` },
})

try {
  // ── Super admin ──────────────────────────────────────────────────────────────
  await publicSql`
    INSERT INTO payroll_auth.super_admins (email, password_hash, name)
    VALUES (${SUPER_ADMIN_EMAIL}, ${superAdminHash}, ${SUPER_ADMIN_NAME})
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          name          = EXCLUDED.name
  `
  console.log(`✓ Super admin : ${SUPER_ADMIN_EMAIL}`)

  // ── Tenant ───────────────────────────────────────────────────────────────────
  await publicSql`
    INSERT INTO payroll_auth.tenants (slug, name, database_schema, status)
    VALUES (${TENANT_SLUG}, ${TENANT_NAME}, ${`tenant_${TENANT_SLUG}`}, 'ACTIVE')
    ON CONFLICT (slug) DO UPDATE
      SET name   = EXCLUDED.name,
          status = 'ACTIVE'
  `
  console.log(`✓ Tenant      : ${TENANT_SLUG}`)

  // ── Tenant user ──────────────────────────────────────────────────────────────
  const [userRow] = await tenantSql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, name, role, is_tenant_admin)
    VALUES (${USER_EMAIL}, ${userHash}, ${USER_NAME}, ${'ADMIN'}, true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash    = EXCLUDED.password_hash,
          name             = EXCLUDED.name,
          role             = EXCLUDED.role,
          is_tenant_admin  = true
    RETURNING id
  `
  console.log(`✓ Usuario     : ${USER_EMAIL}`)

  // ── System roles + permissions + tenant_admin assignment ─────────────────────
  // These mirror SYSTEM_ROLES from @payroll/types, but inlined so the seed
  // stays runnable from a Bun/Node CLI without bundling the package.
  type SystemRoleSeed = {
    code: 'tenant_admin' | 'hr' | 'accountant' | 'viewer'
    name: string
    description: string
    permissions: string[]
  }

  // tenant_admin gets every tenant-scope code listed in the catalog so a
  // future addition to permissions_catalog flows through automatically.
  const tenantAdminPerms = await tenantSql<{ code: string }[]>`
    SELECT code FROM payroll_auth.permissions_catalog WHERE scope = 'tenant'
  `

  const HR: string[] = [
    'employees:create',
    'employees:read',
    'employees:update',
    'employees:export',
    'employees:import',
    'positions:create',
    'positions:read',
    'positions:update',
    'shifts:create',
    'shifts:read',
    'shifts:update',
    'shifts:assign',
    'attendance:read',
    'attendance:mark',
    'attendance:edit',
    'attendance:approve',
    'attendance:import',
    'vacations:read',
    'vacations:request',
    'vacations:approve',
    'vacations:reject',
    'vacations:cancel',
    'loans:create',
    'loans:read',
    'loans:update',
    'advances:create',
    'advances:read',
    'creditors:read',
    'payroll:read',
    'concepts:read',
    'catalogs:read',
    'payslip:read',
    'payslip:download',
    'payslip:send_email',
    'reports:personnel.view',
    'reports:personnel.export',
    'reports:attendance.view',
    'reports:attendance.export',
  ]
  const ACCOUNTANT: string[] = [
    'employees:read',
    'positions:read',
    'shifts:read',
    'attendance:read',
    'loans:read',
    'loans:approve',
    'advances:read',
    'advances:approve',
    'creditors:read',
    'creditors:create',
    'creditors:update',
    'payroll:read',
    'payroll:create',
    'payroll:generate',
    'payroll:recalculate',
    'payroll:approve',
    'payroll:close',
    'payroll:export',
    'concepts:read',
    'concepts:create',
    'concepts:update',
    'catalogs:read',
    'catalogs:create',
    'catalogs:update',
    'payslip:read',
    'payslip:download',
    'payslip:send_email',
    'reports:payroll.view',
    'reports:payroll.export',
    'reports:loans.view',
  ]
  const VIEWER: string[] = [
    'employees:read',
    'positions:read',
    'shifts:read',
    'attendance:read',
    'vacations:read',
    'loans:read',
    'advances:read',
    'creditors:read',
    'payroll:read',
    'concepts:read',
    'catalogs:read',
    'payslip:read',
    'reports:payroll.view',
    'reports:personnel.view',
    'reports:attendance.view',
  ]

  const systemRoles: SystemRoleSeed[] = [
    {
      code: 'tenant_admin',
      name: 'Administrador',
      description: 'Acceso total a la empresa: usuarios, roles, planillas y configuración.',
      permissions: tenantAdminPerms.map((r) => r.code),
    },
    {
      code: 'hr',
      name: 'Recursos Humanos',
      description: 'Gestión de empleados, asistencias, vacaciones y comprobantes.',
      permissions: HR,
    },
    {
      code: 'accountant',
      name: 'Contabilidad',
      description: 'Generación, aprobación y cierre de planillas; conceptos y reportes contables.',
      permissions: ACCOUNTANT,
    },
    {
      code: 'viewer',
      name: 'Solo lectura',
      description: 'Consulta de información sin permisos de edición.',
      permissions: VIEWER,
    },
  ]

  const roleIds = new Map<string, string>()
  for (const r of systemRoles) {
    const [{ id }] = await tenantSql<{ id: string }[]>`
      INSERT INTO roles (code, name, description, is_system)
      VALUES (${r.code}, ${r.name}, ${r.description}, true)
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            is_system = true,
            updated_at = now()
      RETURNING id
    `
    roleIds.set(r.code, id)

    // Re-grant from scratch so the seed is the authoritative source.
    await tenantSql`DELETE FROM role_permissions WHERE role_id = ${id}`
    if (r.permissions.length > 0) {
      const rows = r.permissions.map((code) => ({ role_id: id, permission_code: code }))
      await tenantSql`
        INSERT INTO role_permissions ${tenantSql(rows, 'role_id', 'permission_code')}
        ON CONFLICT (role_id, permission_code) DO NOTHING
      `
    }
  }
  console.log('✓ Roles       : tenant_admin, hr, accountant, viewer (con permisos)')

  await tenantSql`
    INSERT INTO user_roles (user_id, role_id)
    VALUES (${userRow.id}, ${roleIds.get('tenant_admin')})
    ON CONFLICT (user_id, role_id) DO NOTHING
  `
  // Force JWT refresh on next request so any old cookie picks up the
  // new effective permissions.
  await tenantSql`
    UPDATE users SET permissions_version = permissions_version + 1
     WHERE id = ${userRow.id}
  `
  console.log(`✓ Asignación  : ${USER_EMAIL} → tenant_admin`)

  // ── Función ──────────────────────────────────────────────────────────────────
  await tenantSql`
    INSERT INTO funciones (code, name)
    VALUES ('ADM', 'Administrativo')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  `
  console.log('✓ Función     : ADM - Administrativo')

  // ── Cargo ────────────────────────────────────────────────────────────────────
  await tenantSql`
    INSERT INTO cargos (code, name)
    VALUES ('EMP', 'Empleado General')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  `
  console.log('✓ Cargo       : EMP - Empleado General')

  // ── Departamentos (padre → hijo) ─────────────────────────────────────────────
  const [deptAdmin] = await tenantSql<{ id: string }[]>`
    INSERT INTO departamentos (code, name)
    VALUES ('ADMIN', 'Administración')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `
  console.log('✓ Departamento: ADMIN - Administración')

  await tenantSql`
    INSERT INTO departamentos (code, name, parent_id)
    VALUES ('RRHH', 'Recursos Humanos', ${deptAdmin.id})
    ON CONFLICT (code) DO UPDATE
      SET name      = EXCLUDED.name,
          parent_id = EXCLUDED.parent_id
  `
  console.log('✓ Departamento: RRHH - Recursos Humanos (hijo de ADMIN)')

  // ── Horario ──────────────────────────────────────────────────────────────────
  await tenantSql`
    INSERT INTO shifts (
      name, entry_time, lunch_start_time, lunch_end_time, exit_time, is_default
    )
    SELECT 'Turno Regular 8-5', '08:00'::time, '12:00'::time, '13:00'::time, '17:00'::time, true
    WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE name = 'Turno Regular 8-5')
  `
  console.log('✓ Horario     : Turno Regular 8-5 (08:00-12:00 / 13:00-17:00)')

  // ── Concepto del acreedor ────────────────────────────────────────────────────
  const [creditorConcept] = await tenantSql<{ id: string }[]>`
    INSERT INTO concepts (code, name, type, formula, is_active)
    VALUES ('PRST_BN', 'Préstamo Banco Nacional', 'deduction', '0', true)
    ON CONFLICT (code) DO UPDATE
      SET name      = EXCLUDED.name,
          type      = EXCLUDED.type,
          formula   = EXCLUDED.formula
    RETURNING id
  `

  // ── Acreedor ─────────────────────────────────────────────────────────────────
  await tenantSql`
    INSERT INTO creditors (code, name, description, concept_id)
    VALUES ('BN', 'Banco Nacional', 'Banco Nacional de Panamá', ${creditorConcept.id})
    ON CONFLICT (code) DO UPDATE
      SET name       = EXCLUDED.name,
          description = EXCLUDED.description,
          concept_id  = EXCLUDED.concept_id
  `
  console.log('✓ Acreedor    : BN - Banco Nacional')

  // ── Conceptos de nómina ──────────────────────────────────────────────────────
  const nominaConcepts = [
    {
      code: 'SUELDO',
      name: 'Sueldo',
      type: 'income',
      formula: 'SALARIO*0.5',
    },
    {
      code: 'SS',
      name: 'Seguro Social',
      type: 'deduction',
      formula: 'CONCEPTO("SUELDO")*0.095',
    },
    {
      code: 'SE',
      name: 'Seguro Educativo',
      type: 'deduction',
      formula: 'CONCEPTO("SUELDO")*0.0975',
    },
    {
      code: 'SSP',
      name: 'Seguro Social Patronal',
      type: 'deduction',
      formula: 'CONCEPTO("SUELDO")*0.1325',
    },
    {
      code: 'SEP',
      name: 'Seguro Educativo Patronal',
      type: 'deduction',
      formula: 'CONCEPTO("SUELDO")*0.015',
    },
  ]

  for (const c of nominaConcepts) {
    await tenantSql`
      INSERT INTO concepts (code, name, type, formula, is_active)
      VALUES (${c.code}, ${c.name}, ${c.type}, ${c.formula}, true)
      ON CONFLICT (code) DO UPDATE
        SET name    = EXCLUDED.name,
            type    = EXCLUDED.type,
            formula = EXCLUDED.formula
    `
    console.log(`✓ Concepto    : ${c.code} - ${c.name}`)
  }

  // ── Catálogos de conceptos ────────────────────────────────────────────────────

  // Tipos de planilla
  for (const item of [
    { code: 'regular', name: 'Regular', sortOrder: 1 },
    { code: 'thirteenth', name: 'Décimo Tercer Mes', sortOrder: 2 },
    { code: 'special', name: 'Especial', sortOrder: 3 },
  ]) {
    await tenantSql`
      INSERT INTO concept_payroll_types (code, name, sort_order)
      VALUES (${item.code}, ${item.name}, ${item.sortOrder})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
    `
  }
  console.log('✓ Tipos planilla: regular, thirteenth, special')

  // Frecuencias (codes must match freqCodeMap in payroll service)
  for (const item of [
    { code: 'semanal', name: 'Semanal', sortOrder: 1 },
    { code: 'quincenal', name: 'Quincenal', sortOrder: 2 },
    { code: 'mensual', name: 'Mensual', sortOrder: 3 },
    { code: 'thirteenth', name: 'Décimo Tercer Mes', sortOrder: 4 },
    { code: 'liquidacion', name: 'Liquidación', sortOrder: 5 },
  ]) {
    await tenantSql`
      INSERT INTO concept_frequencies (code, name, sort_order)
      VALUES (${item.code}, ${item.name}, ${item.sortOrder})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
    `
  }
  console.log('✓ Frecuencias   : semanal, quincenal, mensual, thirteenth, liquidacion')

  // Situaciones (codes must match service lookup: 'activo')
  for (const item of [
    { code: 'activo', name: 'Activo', sortOrder: 1 },
    { code: 'inactivo', name: 'Inactivo', sortOrder: 2 },
  ]) {
    await tenantSql`
      INSERT INTO concept_situations (code, name, sort_order)
      VALUES (${item.code}, ${item.name}, ${item.sortOrder})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
    `
  }
  console.log('✓ Situaciones   : activo, inactivo')

  // Acumulados (para XIII mes)
  for (const item of [
    { code: 'SALARIO_BASE', name: 'Salario Base', sortOrder: 1 },
    { code: 'HORAS_EXTRAS', name: 'Horas Extras', sortOrder: 2 },
    { code: 'COMISIONES', name: 'Comisiones', sortOrder: 3 },
    { code: 'BONIFICACIONES', name: 'Bonificaciones', sortOrder: 4 },
  ]) {
    await tenantSql`
      INSERT INTO concept_accumulators (code, name, sort_order)
      VALUES (${item.code}, ${item.name}, ${item.sortOrder})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
    `
  }
  console.log('✓ Acumulados    : SALARIO_BASE, HORAS_EXTRAS, COMISIONES, BONIFICACIONES')

  console.log('\n✅  Seed completo!')
  console.log(`  Super admin  : ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`)
  console.log(`  Tenant user  : ${USER_EMAIL} / ${USER_PASSWORD}  (X-Tenant: ${TENANT_SLUG})`)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('does not exist') || msg.includes('no existe')) {
    console.error('\n✗ Tablas no encontradas. Ejecuta las migraciones primero.')
  } else {
    console.error('✗ Seed falló:', msg)
  }
  process.exit(1)
} finally {
  await publicSql.end()
  await tenantSql.end()
}
