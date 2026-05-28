import { useAuth } from '@/contexts/AuthContext'
import { punchQueue } from '@/lib/offline-queue'
import { PUNCH_TYPE_OPTIONS, type PunchType } from '@/types/domain'
/**
 * Pantalla "Marcar". Elige el tipo de marcación y la envía. Todo punch
 * pasa por la cola offline: si hay red se envía al instante, si no, queda
 * persistido y se reintenta solo al recuperar conexión.
 */
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonNote,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react'
import { useEffect, useState } from 'react'

export default function Punch() {
  const { mode, session } = useAuth()
  const [present] = useIonToast()
  const [pending, setPending] = useState(0)
  const [sending, setSending] = useState<PunchType | null>(null)
  // En kiosko el empleado se identifica por facial/NFC (TODO). Mientras
  // tanto, se captura el employeeId manualmente para no bloquear el flujo.
  const [kioskEmployeeId, setKioskEmployeeId] = useState('')

  useEffect(
    () =>
      punchQueue.subscribe((items) => {
        setPending(items.filter((i) => i.status === 'pending').length)
      }),
    []
  )

  const employeeId = mode === 'kiosk' ? kioskEmployeeId.trim() : (session?.employeeId ?? '')

  async function mark(punchType: PunchType) {
    if (!employeeId) {
      await present({
        message:
          mode === 'kiosk'
            ? 'Ingresa el ID del empleado (identificación facial/NFC pendiente).'
            : 'No se pudo determinar el empleado de la sesión.',
        duration: 3000,
        color: 'warning',
      })
      return
    }
    setSending(punchType)
    try {
      const { sent } = await punchQueue.enqueue({
        employeeId,
        punchType,
        source: mode === 'kiosk' ? undefined : 'mobile_app',
      })
      await present({
        message: sent
          ? 'Marcación registrada.'
          : 'Sin conexión: marcación guardada y se enviará automáticamente.',
        duration: 2500,
        color: sent ? 'success' : 'medium',
      })
    } finally {
      setSending(null)
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Marcar</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              {mode === 'kiosk' ? 'Kiosko' : (session?.name ?? 'Empleado')}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {mode === 'kiosk' && (
              <IonItem className="ion-margin-bottom">
                <IonInput
                  label="ID del empleado"
                  labelPlacement="floating"
                  value={kioskEmployeeId}
                  onIonInput={(e) => setKioskEmployeeId(e.detail.value ?? '')}
                />
              </IonItem>
            )}
            {PUNCH_TYPE_OPTIONS.map((opt) => (
              <IonButton
                key={opt.value}
                expand="block"
                className="ion-margin-vertical"
                disabled={sending !== null}
                onClick={() => mark(opt.value)}
              >
                {sending === opt.value ? 'Enviando…' : opt.label}
              </IonButton>
            ))}
          </IonCardContent>
        </IonCard>

        {pending > 0 && (
          <IonNote className="ion-margin-start">
            <IonBadge color="warning">{pending}</IonBadge>{' '}
            <IonText>marcación(es) en cola por enviar</IonText>
          </IonNote>
        )}
      </IonContent>
    </IonPage>
  )
}
