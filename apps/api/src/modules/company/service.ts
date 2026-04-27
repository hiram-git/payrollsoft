import { getCompanyConfig, upsertCompanyConfig } from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export async function getCompanyConfigService(db: AnyDb) {
  return getCompanyConfig(db)
}

export type CompanyConfigInput = {
  companyName?: string | null
  ruc?: string | null
  legalRepresentative?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  tipoInstitucion?: string
  currencyCode?: string
  currencySymbol?: string
  mailHost?: string | null
  mailPort?: number
  mailEncryption?: string
  mailUsername?: string | null
  /** Pass null to clear, pass undefined to keep existing. */
  mailPassword?: string | null
  mailFromAddress?: string | null
  mailFromName?: string | null
  elaboradoPor?: string | null
  cargoElaborador?: string | null
  jefeRecursosHumanos?: string | null
  cargoJefeRrhh?: string | null
  logoEmpresa?: string | null
  logoIzquierdoReportes?: string | null
  logoDerechoReportes?: string | null
  /** 'on_demand' | 'file_storage' — see schema for semantics. */
  payrollReportMode?: string
}

const VALID_REPORT_MODES = new Set(['on_demand', 'file_storage'])

export async function saveCompanyConfigService(db: AnyDb, input: CompanyConfigInput) {
  const existing = await getCompanyConfig(db)

  // If no new password is supplied, keep the stored one
  const mailPassword =
    input.mailPassword !== undefined ? input.mailPassword : (existing?.mailPassword ?? null)

  const data = {
    companyName: input.companyName ?? null,
    ruc: input.ruc ?? null,
    legalRepresentative: input.legalRepresentative ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    tipoInstitucion: input.tipoInstitucion ?? 'privada',
    currencyCode: input.currencyCode ?? 'USD',
    currencySymbol: input.currencySymbol ?? '$',
    mailHost: input.mailHost ?? null,
    mailPort: input.mailPort ?? 587,
    mailEncryption: input.mailEncryption ?? 'tls',
    mailUsername: input.mailUsername ?? null,
    mailPassword,
    mailFromAddress: input.mailFromAddress ?? null,
    mailFromName: input.mailFromName ?? null,
    elaboradoPor: input.elaboradoPor ?? null,
    cargoElaborador: input.cargoElaborador ?? 'Especialista en Nóminas',
    jefeRecursosHumanos: input.jefeRecursosHumanos ?? null,
    cargoJefeRrhh: input.cargoJefeRrhh ?? 'Jefe de Recursos Humanos',
    logoEmpresa: input.logoEmpresa ?? null,
    logoIzquierdoReportes: input.logoIzquierdoReportes ?? null,
    logoDerechoReportes: input.logoDerechoReportes ?? null,
    payrollReportMode:
      input.payrollReportMode && VALID_REPORT_MODES.has(input.payrollReportMode)
        ? input.payrollReportMode
        : (existing?.payrollReportMode ?? 'on_demand'),
  }

  const row = await upsertCompanyConfig(db, data)
  return { success: true as const, data: row }
}
