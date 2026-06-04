import FaceCapture, { type CapturedFace } from '@/components/FaceCapture'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api-client'
import {
  type KioskEmployee,
  buildFacialIdempotencyKey,
  descriptorToArray,
  facialService,
} from '@/lib/facial-service'
import { isOnline } from '@/lib/network'
/**
 * Pantalla "Marcar".
 *
 * Modo Empleado: un solo botón "Marcar con cara". La cámara captura el
 * rostro, el backend verifica que sea el del JWT (anti-fraude) y clasifica
 * el tipo de marca (entrada / salida almuerzo / regreso / salida) por la
 * secuencia diaria.
 *
 * Modo Kiosko (multiempleado): el empleado teclea su cédula y la cámara
 * verifica 1:1 que la cara coincide; el tipo de marca también lo clasifica
 * el backend por secuencia. No hay botones de tipo manuales.
 */
import {
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

// ─── Kiosko multiempleado (cédula + verificación facial 1:1) ───────────

type KioskStep = 'idNumber' | 'camera'

function KioskPunch() {
  const [present] = useIonToast()
  const [step, setStep] = useState<KioskStep>('idNumber')
  const [idNumber, setIdNumber] = useState('')
  const [employee, setEmployee] = useState<KioskEmployee | null>(null)
  const [busy, setBusy] = useState(false)

  function reset() {
    setStep('idNumber')
    setIdNumber('')
    setEmployee(null)
    setBusy(false)
  }

  async function lookup() {
    const id = idNumber.trim()
    if (!id) {
      await present({ message: 'Ingresa la cédula.', duration: 2500, color: 'warning' })
      return
    }
    if (!(await isOnline())) {
      await present({
        message: 'Sin conexión. El kiosko requiere conexión para verificar la identidad.',
        duration: 4000,
        color: 'warning',
      })
      return
    }
    setBusy(true)
    try {
      const emp = await facialService.kioskLookup(id)
      if (!emp.hasEnrollment) {
        await present({
          message: `${emp.firstName} ${emp.lastName} no tiene cara registrada. Debe enrolarse primero.`,
          duration: 4000,
          color: 'warning',
        })
        setBusy(false)
        return
      }
      setEmployee(emp)
      setStep('camera')
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'No se pudo buscar el empleado.'
      await present({ message, duration: 3500, color: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function handleCaptured(face: CapturedFace) {
    if (!employee) return
    setBusy(true)
    try {
      const capturedAt = new Date()
      const result = await facialService.kioskMark({
        idNumber: idNumber.trim(),
        embedding: descriptorToArray(face.descriptor),
        livenessScore: face.liveness,
        capturedAt: capturedAt.toISOString(),
        idempotencyKey: buildFacialIdempotencyKey(employee.id, capturedAt),
      })
      const label = KIND_LABELS[result.kind] ?? result.kind
      await present({
        message: result.deduped
          ? `${result.employee.firstName}: ${label} (ya registrada).`
          : `${result.employee.firstName}: ${label} registrada.`,
        duration: 3000,
        color: 'success',
      })
      reset()
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'No se pudo registrar la marcación.'
      await present({ message, duration: 4000, color: 'danger' })
      reset()
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Kiosko</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardSubtitle>Marcación facial</IonCardSubtitle>
            <IonCardTitle>
              {step === 'idNumber'
                ? 'Identifícate'
                : `${employee?.firstName} ${employee?.lastName}`}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {step === 'idNumber' ? (
              <>
                <IonItem className="ion-margin-bottom">
                  <IonInput
                    label="Cédula"
                    labelPlacement="floating"
                    value={idNumber}
                    inputmode="text"
                    onIonInput={(e) => setIdNumber(e.detail.value ?? '')}
                  />
                </IonItem>
                <IonButton expand="block" disabled={busy || !idNumber} onClick={lookup}>
                  {busy ? 'Buscando…' : 'Continuar'}
                </IonButton>
              </>
            ) : busy ? (
              <div className="ion-text-center ion-padding">
                <IonSpinner />
                <IonNote>Verificando…</IonNote>
              </div>
            ) : (
              <>
                <IonNote>Mira a la cámara y parpadea para confirmar tu identidad.</IonNote>
                <FaceCapture
                  onCapture={handleCaptured}
                  onError={(e) =>
                    present({ message: e.message, duration: 3500, color: 'danger' }).catch(() => {})
                  }
                />
                <IonButton expand="block" fill="outline" className="ion-margin-top" onClick={reset}>
                  Cancelar
                </IonButton>
              </>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  )
}
