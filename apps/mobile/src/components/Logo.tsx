/**
 * Logotipo de PayrollSoft, portado del sistema web (AuthLayout/AppLayout):
 * un cuadro navy (#003087, radio 4px) con la inicial "P" en serif blanco,
 * acompañado del wordmark "PayrollSoft" y un subtítulo opcional.
 *
 * Autocontenido: no depende de fuentes de red (la app debe verse bien
 * sin conexión), así que la "P" usa la pila serif del sistema —
 * equivalente al fallback del web (`'Fraunces','Times New Roman',serif`).
 */

type Props = {
  /** Tamaño del cuadro de la marca en px. Default 40. */
  size?: number
  /** Muestra el wordmark "PayrollSoft" junto a la marca. Default true. */
  withWordmark?: boolean
  /** Subtítulo bajo el wordmark. Pásalo vacío para ocultarlo. */
  subtitle?: string
}

const NAVY = '#003087'

export default function Logo({
  size = 40,
  withWordmark = true,
  subtitle = 'Sistema de planillas',
}: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: 4,
          background: NAVY,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          fontFamily: "'Fraunces','Times New Roman',serif",
          fontWeight: 400,
          fontSize: Math.round(size * 0.55),
          letterSpacing: '-0.02em',
          flexShrink: 0,
        }}
      >
        P
      </div>
      {withWordmark && (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '0.02em' }}>PayrollSoft</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--ion-color-medium, #7a8499)' }}>
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
