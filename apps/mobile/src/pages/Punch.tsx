import FaceCapture, { type CapturedFace } from '@/components/FaceCapture'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api-client'
import { buildFacialIdempotencyKey, descriptorToArray, facialService } from '@/lib/facial-service'
import { isOnline } from '@/lib/network'
import { punchQueue } from '@/lib/offline-queue'
import { PUNCH_TYPE_OPTIONS, type PunchType } from '@/types/domain'
/**
 * Pantalla "Marcar".
 *
 * Modo Empleado (este caso): un solo botón "Marcar con cara". La cámara
 * captura el rostro, el backend verifica que sea el del JWT (anti-fraude)
 * y clasifica el tipo de marca (entrada / salida almuerzo / regreso /
 * salida) por la secuencia diaria. NO hay 4 botones manuales.
 *
 * Modo Kiosko (legacy): mantiene los 4 botones con ID manual del empleado
 * hasta que se implemente el flujo facial multi-empleado.
 */
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonNote,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react'
import { useEffect, useState } from 'react'
import { useHistory } from 'react-router-dom'

const KIND_LABELS: Record<string, string> = {
  entry: 'Entrada',
  lunch_start: 'Salida a almuerzo',
  lunch_end: 'Regreso de almuerzo',
  exit: 'Salida',
  extra: 'Marca adicional',
}

export default function Punch() {
  const { mode, session } = useAuth()
  if (mode === 'kiosk') return <KioskPunch />
  return <EmployeePunch session={session} />
}

// ─── Empleado ──────────────────────────────────────────────────────────

type EmployeeSession = { employeeId?: string; employeeCode?: string; name?: string } | null

function EmployeePunch({ session }: { session: EmployeeSession }) {
  const history = useHistory()
  const [present] = useIonToast()
  const [enrolled, setEnrolled] = useState<boolean | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    facialService
      .me()
      .then(({ hasEnrollment }) => {
        if (alive) setEnrolled(hasEnrollment)
      })
      .catch(() => {
        if (alive) setEnrolled(false)
      })
    return () => {
      alive = false
    }
  }, [])

  async function startMarking() {
    if (!(await isOnline())) {
      await present({
        message:
          'Sin conexión. La marcación con reconocimiento facial requiere conexión para validar la identidad.',
        duration: 4000,
        color: 'warning',
      })
      return
    }
    setCapturing(true)
  }

  async function handleCaptured(face: CapturedFace) {
    setSubmitting(true)
    try {
      const embedding = descriptorToArray(face.descriptor)
      const matchResult = await facialService.match(embedding)
      if (!matchResult.matched) {
        const reason =
          matchResult.reason === 'no_enrollment'
            ? 'Aún no tienes una cara registrada.'
            : 'No reconocimos tu cara. Vuelve a intentarlo bajo mejor iluminación.'
        await present({ message: reason, duration: 4000, color: 'danger' })
        setCapturing(false)
        setSubmitting(false)
        if (matchResult.reason === 'no_enrollment') history.replace('/face-enroll')
        return
      }

      const capturedAt = new Date()
      const result = await facialService.record({
        embedding,
        confidence: matchResult.confidence,
        matchDistance: matchResult.distance,
        livenessScore: face.liveness,
        matchedEnrollmentId: matchResult.enrollmentId,
        capturedAt: capturedAt.toISOString(),
        idempotencyKey: buildFacialIdempotencyKey(session?.employeeId ?? 'me', capturedAt),
      })

      const label = KIND_LABELS[result.kind] ?? result.kind
      await present({
        message: result.deduped ? `${label} (ya registrada).` : `${label} registrada.`,
        duration: 2500,
        color: 'success',
      })
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'No se pudo registrar la marcación.'
      await present({ message, duration: 4000, color: 'danger' })
    } finally {
      setCapturing(false)
      setSubmitting(false)
    }
  }

  if (enrolled === null) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Marcar</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-text-center ion-padding">
          <IonSpinner />
        </IonContent>
      </IonPage>
    )
  }

  if (!enrolled) {
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
              <IonCardSubtitle>Primer uso</IonCardSubtitle>
              <IonCardTitle>Registra tu cara</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonNote>
                Para marcar con reconocimiento facial necesitas registrar tu cara una sola vez.
              </IonNote>
              <IonButton
                expand="block"
                className="ion-margin-top"
                onClick={() => history.push('/face-enroll')}
              >
                Registrar mi cara
              </IonButton>
            </IonCardContent>
          </IonCard>
        </IonContent>
      </IonPage>
    )
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
            <IonCardTitle>{session?.name ?? 'Empleado'}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {capturing ? (
              submitting ? (
                <div className="ion-text-center ion-padding">
                  <IonSpinner />
                  <IonNote>Procesando…</IonNote>
                </div>
              ) : (
                <FaceCapture
                  onCapture={handleCaptured}
                  onError={(e) =>
                    present({ message: e.message, duration: 3500, color: 'danger' }).catch(() => {})
                  }
                />
              )
            ) : (
              <>
                <IonNote>
                  Toca el botón, mira a la cámara y parpadea una vez. El sistema reconoce tu cara y
                  registra la marcación; el tipo (entrada, almuerzo o salida) se asigna
                  automáticamente.
                </IonNote>
                <IonButton expand="block" className="ion-margin-top" onClick={startMarking}>
                  Marcar con cara
                </IonButton>
              </>
            )}
            {capturing && !submitting && (
              <IonButton
                expand="block"
                fill="outline"
                className="ion-margin-top"
                onClick={() => setCapturing(false)}
              >
                Cancelar
              </IonButton>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  )
}

// ─── Kiosko (legacy) ───────────────────────────────────────────────────

function KioskPunch() {
  const [present] = useIonToast()
  const [pending, setPending] = useState(0)
  const [sending, setSending] = useState<PunchType | null>(null)
  const [employeeId, setEmployeeId] = useState('')

  useEffect(
    () =>
      punchQueue.subscribe((items) => {
        setPending(items.filter((i) => i.status === 'pending').length)
      }),
    []
  )

  async function mark(punchType: PunchType) {
    if (!employeeId.trim()) {
      await present({
        message: 'Ingresa el ID del empleado.',
        duration: 3000,
        color: 'warning',
      })
      return
    }
    setSending(punchType)
    try {
      const { sent } = await punchQueue.enqueue({ employeeId: employeeId.trim(), punchType })
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
          <IonTitle>Marcar (Kiosko)</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardContent>
            <IonItem className="ion-margin-bottom">
              <IonInput
                label="ID del empleado"
                labelPlacement="floating"
                value={employeeId}
                onIonInput={(e) => setEmployeeId(e.detail.value ?? '')}
              />
            </IonItem>
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
