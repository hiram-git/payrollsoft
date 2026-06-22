/**
 * Logotipo de RCG SOFTRIX, portado del sistema web (AppLayout/AuthLayout):
 * el isotipo oficial (degradado verde→negro) sobre un plato blanco con
 * padding y un hairline sutil — la misma presentación que usa el web para
 * que el degradado sea legible sobre cualquier fondo — acompañado del
 * wordmark "RCG SOFTRIX" y un subtítulo opcional.
 *
 * El isotipo es un asset real (`/brand/rcg-mark.png`) empaquetado en el
 * APK, así que se ve igual sin conexión.
 */

type Props = {
  /** Tamaño del plato de la marca en px. Default 40. */
  size?: number
  /** Muestra el wordmark "RCG SOFTRIX" junto a la marca. Default true. */
  withWordmark?: boolean
  /** Subtítulo bajo el wordmark. Pásalo vacío para ocultarlo. */
  subtitle?: string
}

export default function Logo({
  size = 40,
  withWordmark = true,
  subtitle = 'Recursos Humanos, Planilla y Asistencia',
}: Props) {
  const pad = Math.max(3, Math.round(size * 0.1))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          background: '#fff',
          padding: pad,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
      >
        <img
          src="/brand/rcg-mark.png"
          alt="RCG SOFTRIX"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
      {withWordmark && (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '0.02em' }}>RCG SOFTRIX</div>
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
