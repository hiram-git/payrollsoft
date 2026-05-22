/**
 * Wrapper isomórfico para producir el Buffer del PDF de cheques.
 * Centralizar aquí permite que endpoints distintos compartan un
 * solo code path para `renderToBuffer` y la conversión a Uint8Array.
 */
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { CheckPdf, type CheckPdfEntry, type CheckPdfLayout } from './check-pdf'

export async function renderCheckPdfBuffer(
  checks: CheckPdfEntry[],
  layout?: CheckPdfLayout
): Promise<Uint8Array> {
  const element = React.createElement(CheckPdf, { checks, layout })
  // @react-pdf/renderer's `renderToBuffer` signature no matchea con el
  // FunctionComponentElement de React 19; el runtime es correcto, el
  // cast silencia la diferencia sin desactivar tipado del resto.
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  return new Uint8Array(buffer)
}
