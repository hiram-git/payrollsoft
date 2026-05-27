import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { type TransferenciasGroup, TransferenciasPdf } from '../../../../lib/pdf/transferencias-pdf'
import {
  computeBuckets,
  computePatrono,
  fetchGovernmentReportData,
} from '../../../../lib/reports/government-data'

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const payrollId = url.searchParams.get('payrollId')
  if (!payrollId) return new Response('payrollId requerido', { status: 400 })

  const result = await fetchGovernmentReportData(payrollId, authCookie)
  if (result.kind === 'unauthorized') return redirect('/login')
  if (result.kind === 'not-found') return new Response('Planilla no encontrada', { status: 404 })
  if (result.kind === 'bad-status') return new Response('Planilla no generada', { status: 409 })
  if (result.kind === 'error') return new Response(result.message, { status: result.status })

  const { payroll, company, groups, ungrouped } = result.data
  const isXIII = payroll.type === 'thirteenth'
  const riskRate = 0.0098

  const allGroups = [...groups]
  if (ungrouped.length > 0) {
    allGroups.push({
      partida: { id: '', code: 'SIN PARTIDA', name: 'Sin partida' },
      lines: ungrouped,
    })
  }

  const mapped: TransferenciasGroup[] = allGroups.map((g) => {
    let devengado = 0
    let ss = 0
    let se = 0
    let siacap = 0
    let isr = 0
    let otrasDeduciones = 0
    let neto = 0
    for (const l of g.lines) {
      const b = computeBuckets(l.line.concepts)
      devengado += b.devengado
      ss += b.ss
      se += b.se
      siacap += b.siacap
      isr += b.isr
      otrasDeduciones += b.otrasDeduciones
      neto += b.neto
    }
    const patrono = computePatrono(devengado, { isThirteenthMonth: isXIII, riskRate })
    const totalPatrono =
      devengado + patrono.ssPatrono + patrono.sePatrono + patrono.rpPatrono + patrono.siacapPatrono
    return {
      partida: g.partida,
      buckets: {
        devengado,
        ss,
        se,
        siacap,
        isr,
        otrasDeduciones,
        neto,
        ...patrono,
        totalPatrono,
      },
    }
  })

  const totals = mapped.reduce(
    (acc, g) => {
      acc.devengado += g.buckets.devengado
      acc.ss += g.buckets.ss
      acc.se += g.buckets.se
      acc.siacap += g.buckets.siacap
      acc.isr += g.buckets.isr
      acc.otrasDeduciones += g.buckets.otrasDeduciones
      acc.neto += g.buckets.neto
      acc.ssPatrono += g.buckets.ssPatrono
      acc.sePatrono += g.buckets.sePatrono
      acc.rpPatrono += g.buckets.rpPatrono
      acc.siacapPatrono += g.buckets.siacapPatrono
      acc.totalPatrono += g.buckets.totalPatrono
      return acc
    },
    {
      devengado: 0,
      ss: 0,
      se: 0,
      siacap: 0,
      isr: 0,
      otrasDeduciones: 0,
      neto: 0,
      ssPatrono: 0,
      sePatrono: 0,
      rpPatrono: 0,
      siacapPatrono: 0,
      totalPatrono: 0,
    }
  )

  const element = React.createElement(TransferenciasPdf, {
    payroll,
    company,
    groups: mapped,
    totals,
  })
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  const pdfBytes = new Uint8Array(buffer)

  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="transferencias-${payrollId.slice(0, 8)}.pdf"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
