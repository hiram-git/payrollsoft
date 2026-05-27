import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import { getCompanyConfigService, saveCompanyConfigService } from './service'

const CompanyConfigBody = t.Object({
  companyName: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  ruc: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
  legalRepresentative: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  address: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  phone: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  email: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  institutionType: t.Optional(t.String()),
  currencyCode: t.Optional(t.String()),
  currencySymbol: t.Optional(t.String()),
  mailHost: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  mailPort: t.Optional(t.Number()),
  mailEncryption: t.Optional(t.String()),
  mailUsername: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  // null = clear password; undefined/omitted = keep existing
  mailPassword: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  mailFromAddress: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  mailFromName: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  preparedBy: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  preparerTitle: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  hrDirectorName: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  hrDirectorTitle: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  companyLogo: t.Optional(t.Nullable(t.String())),
  reportLogoLeft: t.Optional(t.Nullable(t.String())),
  reportLogoRight: t.Optional(t.Nullable(t.String())),
  payrollReportMode: t.Optional(
    t.Union([t.Literal('on_demand'), t.Literal('file_storage'), t.Literal('local_storage')])
  ),
})

export const companyRoutes = new Elysia({ prefix: '/company' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getCompanyConfigService(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardPermission('settings:company.read')] }
  )

  .put(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await saveCompanyConfigService(db, body)
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('settings:company.update')],
      body: CompanyConfigBody,
    }
  )
