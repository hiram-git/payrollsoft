/**
 * Rutas HTTP del módulo de tesorería.
 *
 *   GET    /banks                              listar bancos
 *   POST   /banks                              crear banco
 *   PUT    /banks/:id                          editar
 *
 *   GET    /treasury/checkbooks                listar chequeras
 *   POST   /treasury/checkbooks                crear chequera
 *
 *   GET    /treasury/runs                      listar corridas
 *   POST   /treasury/runs                      crear corrida
 *   POST   /treasury/runs/:id/close            cerrar corrida
 *
 *   POST   /treasury/runs/:id/checks           emitir cheque
 *   POST   /treasury/checks/:id/void           anular cheque
 *   POST   /treasury/checks/:id/print          marcar como impreso
 *
 *   POST   /treasury/runs/:id/ach              generar TXT ACH
 *   GET    /treasury/ach/:batchId              detalle del batch
 *   GET    /treasury/ach/:batchId/download     descarga el TXT
 *
 *   GET    /treasury/payables?payrollId=…      vista previa de pagables
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  type AchScope,
  generateBancoGeneralFile,
  generateBancoNacionalFile,
  generateBloqueoMensualFile,
  generateBloqueoQuincenalFile,
} from './file-service'
import {
  closePaymentRun,
  createBank,
  createCheckbook,
  createPaymentRun,
  generateAchBatch,
  getAchBatch,
  getCheckWithChequera,
  getClosedPayrollIdsForMonth,
  getCreditorPayables,
  getEmployeePayables,
  issueCheck,
  issueChecksBulk,
  listAllAchBatches,
  listAllChecks,
  listBanks,
  listCheckbooks,
  listChecksByRun,
  listPaymentRuns,
  markCheckPrinted,
  updateBank,
  voidCheck,
} from './service'

export const treasuryRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  // ── Bancos ──────────────────────────────────────────────────────────────
  .get(
    '/banks',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listBanks(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('banks:read')] }
  )

  .post(
    '/banks',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await createBank(db, body)
      set.status = 201
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('banks:write')],
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 20 }),
        name: t.String({ minLength: 1, maxLength: 120 }),
        routing: t.Optional(t.Nullable(t.String({ maxLength: 15 }))),
        swift: t.Optional(t.Nullable(t.String({ maxLength: 15 }))),
        achFormat: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
        achEntityCode: t.Optional(t.Nullable(t.String({ maxLength: 9 }))),
      }),
    }
  )

  .put(
    '/banks/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await updateBank(db, params.id, body)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Banco no encontrado' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('banks:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        routing: t.Optional(t.Nullable(t.String({ maxLength: 15 }))),
        swift: t.Optional(t.Nullable(t.String({ maxLength: 15 }))),
        achFormat: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
        achEntityCode: t.Optional(t.Nullable(t.String({ maxLength: 9 }))),
        isActive: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
        sortOrder: t.Optional(t.Integer()),
      }),
    }
  )

  // ── Chequeras ───────────────────────────────────────────────────────────
  .get(
    '/treasury/checkbooks',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listCheckbooks(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')] }
  )

  .post(
    '/treasury/checkbooks',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createCheckbook(db, body)
      if (!result.ok) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: { id: result.id } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 30 }),
        name: t.String({ minLength: 1, maxLength: 160 }),
        bankId: t.Optional(t.Nullable(t.String())),
        accountNumber: t.String({ minLength: 1, maxLength: 40 }),
        startNumber: t.Integer({ minimum: 1 }),
        endNumber: t.Integer({ minimum: 1 }),
        purpose: t.Union([t.Literal('employees'), t.Literal('creditors'), t.Literal('general')]),
      }),
    }
  )

  // ── Corridas de pago ────────────────────────────────────────────────────
  .get(
    '/treasury/runs',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listPaymentRuns(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')] }
  )

  .post(
    '/treasury/runs',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createPaymentRun(db, body, { createdBy: user?.userId ?? null })
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: { id: result.id } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      body: t.Object({
        payrollId: t.Optional(t.Nullable(t.String())),
        name: t.String({ minLength: 1, maxLength: 255 }),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    }
  )

  .post(
    '/treasury/runs/:id/close',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      await closePaymentRun(db, params.id)
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Vista previa de pagables ────────────────────────────────────────────
  .get(
    '/treasury/payables',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const payrollId = (query.payrollId ?? '').trim()
      if (!payrollId) {
        set.status = 400
        return { success: false, error: 'payrollId es obligatorio' }
      }
      const data = await getEmployeePayables(db, payrollId)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')],
      query: t.Object({ payrollId: t.Optional(t.String()) }),
    }
  )

  // ── Pagables de acreedores (suma de ACR_* por proveedor) ────────────────
  .get(
    '/treasury/creditor-payables',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      let payrollIds: string[] = []
      if (query.payrollId?.trim()) {
        payrollIds = [query.payrollId.trim()]
      } else if (query.month && query.year) {
        payrollIds = await getClosedPayrollIdsForMonth(db, Number(query.month), Number(query.year))
      } else {
        set.status = 400
        return { success: false, error: 'Indica payrollId o month+year' }
      }
      const data = await getCreditorPayables(db, payrollIds)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')],
      query: t.Object({
        payrollId: t.Optional(t.String()),
        month: t.Optional(t.String()),
        year: t.Optional(t.String()),
      }),
    }
  )

  // ── Cheques ─────────────────────────────────────────────────────────────
  .get(
    '/treasury/checks',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listAllChecks(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')] }
  )

  .get(
    '/treasury/checks/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getCheckWithChequera(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Cheque no encontrado' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  .get(
    '/treasury/runs/:id/checks',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listChecksByRun(db, params.id)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/treasury/runs/:id/checks',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await issueCheck(
        db,
        { ...body, paymentRunId: params.id },
        { createdBy: user?.userId ?? null }
      )
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        checkbookId: t.String(),
        beneficiaryType: t.Union([
          t.Literal('employee'),
          t.Literal('creditor'),
          t.Literal('other'),
        ]),
        beneficiaryRefId: t.Optional(t.Nullable(t.String())),
        beneficiaryName: t.String({ minLength: 1, maxLength: 255 }),
        amount: t.Union([t.Number(), t.String()]),
        concept: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
        issueDate: t.String({ minLength: 10, maxLength: 10 }),
      }),
    }
  )

  // Emisión masiva: un cheque por cada beneficiario con método cheque
  .post(
    '/treasury/runs/:id/checks/bulk',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const scope =
        body.beneficiary === 'creditors'
          ? body.month && body.year
            ? ({ beneficiary: 'creditors', month: body.month, year: body.year } as const)
            : null
          : ({ beneficiary: 'employees', payrollId: body.payrollId ?? '' } as const)
      if (!scope || (scope.beneficiary === 'employees' && !scope.payrollId)) {
        set.status = 422
        return {
          success: false,
          error:
            body.beneficiary === 'creditors'
              ? 'month y year son obligatorios para acreedores.'
              : 'payrollId es obligatorio para empleados.',
        }
      }
      const result = await issueChecksBulk(
        db,
        {
          paymentRunId: params.id,
          checkbookId: body.checkbookId,
          issueDate: body.issueDate,
          scope,
          concept: body.concept ?? null,
        },
        { createdBy: user?.userId ?? null }
      )
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        checkbookId: t.String(),
        issueDate: t.String({ minLength: 10, maxLength: 10 }),
        beneficiary: t.Union([t.Literal('employees'), t.Literal('creditors')]),
        payrollId: t.Optional(t.String()),
        month: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        year: t.Optional(t.Integer({ minimum: 2000, maximum: 2100 })),
        concept: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    }
  )

  .post(
    '/treasury/checks/:id/void',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await voidCheck(db, params.id, body.reason ?? '', user?.userId ?? '')
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:void')],
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.String({ minLength: 3, maxLength: 500 }) }),
    }
  )

  .post(
    '/treasury/checks/:id/print',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      await markCheckPrinted(db, params.id)
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:print')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── ACH ─────────────────────────────────────────────────────────────────
  .post(
    '/treasury/runs/:id/ach',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await generateAchBatch(
        db,
        { ...body, paymentRunId: params.id },
        { generatedBy: user?.userId ?? null }
      )
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        payrollId: t.String(),
        sourceBankId: t.Optional(t.Nullable(t.String())),
        frequency: t.String({ minLength: 1, maxLength: 30 }),
        month: t.Integer({ minimum: 1, maximum: 12 }),
        year: t.Integer({ minimum: 2000, maximum: 2100 }),
        paymentDate: t.String({ minLength: 10, maxLength: 10 }),
      }),
    }
  )

  .get(
    '/treasury/ach',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listAllAchBatches(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')] }
  )

  .get(
    '/treasury/ach/:batchId',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const batch = await getAchBatch(db, params.batchId)
      if (!batch) {
        set.status = 404
        return { success: false, error: 'Batch no encontrado' }
      }
      // Devolver metadata sin el content (que puede ser grande).
      const { fileContent, ...meta } = batch as { fileContent: string }
      void fileContent
      return { success: true, data: meta }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')],
      params: t.Object({ batchId: t.String() }),
    }
  )

  .get(
    '/treasury/ach/:batchId/download',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return 'Tenant required'
      }
      const batch = await getAchBatch(db, params.batchId)
      if (!batch) {
        set.status = 404
        return 'Batch no encontrado'
      }
      const b = batch as { fileName: string; fileContent: string; format?: string }
      const disposition = `attachment; filename="${b.fileName}"`
      // El formato de Banco Nacional (líneas L) viaja en Latin-1 (la Ñ es 0xD1);
      // el resto es ASCII/LF.
      if (b.format === 'banco_nacional') {
        return new Response(Buffer.from(b.fileContent, 'latin1'), {
          headers: { 'Content-Type': 'text/plain; charset=iso-8859-1', 'Content-Disposition': disposition },
        })
      }
      set.headers['Content-Type'] = 'text/plain; charset=ascii'
      set.headers['Content-Disposition'] = disposition
      return b.fileContent
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:read')],
      params: t.Object({ batchId: t.String() }),
    }
  )

  // ── Archivos de banco / contraloría (multi-formato) ─────────────────────
  .post(
    '/treasury/runs/:id/files',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const generatedBy = user?.userId ?? null
      const beneficiary = body.beneficiary ?? 'employees'
      let result: Awaited<ReturnType<typeof generateBancoNacionalFile>>

      if (body.format === 'banco_nacional' || body.format === 'banco_general') {
        if (!body.sourceBankId) {
          set.status = 422
          return { success: false, error: 'sourceBankId es obligatorio para este formato.' }
        }
        let scope: AchScope
        if (beneficiary === 'creditors') {
          if (!body.month || !body.year) {
            set.status = 422
            return { success: false, error: 'month y year son obligatorios para acreedores.' }
          }
          scope = { beneficiary: 'creditors', month: body.month, year: body.year }
        } else {
          scope = { beneficiary: 'employees', payrollId: body.payrollId }
        }
        const fn =
          body.format === 'banco_nacional' ? generateBancoNacionalFile : generateBancoGeneralFile
        result = await fn(
          db,
          {
            paymentRunId: params.id,
            scope,
            sourceBankId: body.sourceBankId,
            description: body.description ?? undefined,
          },
          { generatedBy }
        )
      } else {
        result = await generateBloqueoQuincenalFile(
          db,
          { paymentRunId: params.id, payrollId: body.payrollId },
          { generatedBy }
        )
      }

      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        format: t.Union([
          t.Literal('banco_nacional'),
          t.Literal('banco_general'),
          t.Literal('bloqueo_quincenal'),
        ]),
        payrollId: t.String(),
        beneficiary: t.Optional(t.Union([t.Literal('employees'), t.Literal('creditors')])),
        month: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        year: t.Optional(t.Integer({ minimum: 2000, maximum: 2100 })),
        sourceBankId: t.Optional(t.Nullable(t.String())),
        description: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      }),
    }
  )

  .post(
    '/treasury/bloqueo-mensual',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await generateBloqueoMensualFile(db, body, { generatedBy: user?.userId ?? null })
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('treasury:write')],
      body: t.Object({
        month: t.Integer({ minimum: 1, maximum: 12 }),
        year: t.Integer({ minimum: 2000, maximum: 2100 }),
      }),
    }
  )
