import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { type RecapitulacionGroup, RecapitulacionPdf } from '../../../../lib/pdf/recapitulacion-pdf'
import { computeBuckets, fetchGovernmentReportData } from '../../../../lib/reports/government-data'

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
  const allGroups = [...groups]
  if (ungrouped.length > 0) {
    allGroups.push({
      partida: { id: '', code: 'SIN PARTIDA', name: 'Sin partida' },
      lines: ungrouped,
    })
  }

  const mapped: RecapitulacionGroup[] = allGroups.map((g) => {
    let sueldoQuinc = 0
    const descLic = 0
    let siacap = 0
    let se = 0
    let isr = 0
    let ss = 0
    let otrasDeduciones = 0
    for (const l of g.lines) {
      const b = computeBuckets(l.line.concepts)
      sueldoQuinc += b.sueldo
      siacap += b.siacap
      se += b.se
      isr += b.isr
      ss += b.ss
      otrasDeduciones += b.otrasDeduciones
    }
    const devengado = sueldoQuinc - descLic
    const totalDescuentos = siacap + se + isr + ss + otrasDeduciones
    const neto = devengado - totalDescuentos
    return {
      partida: g.partida,
      buckets: {
        sueldoQuinc,
        descLic,
        devengado,
        siacap,
        se,
        isr,
        ss,
        otrasDeduciones,
        totalDescuentos,
        neto,
      },
    }
  })

  const totals = mapped.reduce(
    (acc, g) => {
      acc.sueldoQuinc += g.buckets.sueldoQuinc
      acc.descLic += g.buckets.descLic
      acc.devengado += g.buckets.devengado
      acc.siacap += g.buckets.siacap
      acc.se += g.buckets.se
      acc.isr += g.buckets.isr
      acc.ss += g.buckets.ss
      acc.otrasDeduciones += g.buckets.otrasDeduciones
      acc.totalDescuentos += g.buckets.totalDescuentos
      acc.neto += g.buckets.neto
      return acc
    },
    {
      sueldoQuinc: 0,
      descLic: 0,
      devengado: 0,
      siacap: 0,
      se: 0,
      isr: 0,
      ss: 0,
      otrasDeduciones: 0,
      totalDescuentos: 0,
      neto: 0,
    }
  )

  const element = React.createElement(RecapitulacionPdf, {
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
      'Content-Disposition': `attachment; filename="recapitulacion-${payrollId.slice(0, 8)}.pdf"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
