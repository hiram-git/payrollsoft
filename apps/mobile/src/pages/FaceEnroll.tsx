import FaceCapture, { type CapturedFace } from '@/components/FaceCapture'
import { ApiError } from '@/lib/api-client'
import { descriptorToArray, facialService } from '@/lib/facial-service'
/**
 * Pantalla de enrolamiento facial.
 *
 * El empleado captura su cara una vez para que el backend la asocie a su
 * cuenta. Es requisito previo a marcar: sin enrolamiento, el match falla
 * y no se pueden registrar marcaciones.
 *
 * Se llega aquí de dos formas:
 *   - automáticamente desde Punch.tsx si /portal/facial/me dice que no
 *     hay enrolamiento activo,
 *   - manualmente desde la pestaña Cuenta (gestión).
 */
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonNote,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react'
import { useState } from 'react'
import { useHistory } from 'react-router-dom'

export default function FaceEnroll() {
  const history = useHistory()
  const [present] = useIonToast()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleCapture(face: CapturedFace) {
    setSubmitting(true)
    try {
      await facialService.enroll({
        embedding: descriptorToArray(face.descriptor),
        qualityScore: face.score,
      })
      setDone(true)
      await present({
        message: 'Tu cara fue registrada correctamente.',
        duration: 2500,
        color: 'success',
      })
      history.replace('/app/punch')
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'No se pudo registrar tu cara.'
      await present({ message, duration: 4000, color: 'danger' })
      setSubmitting(false)
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/app/account" />
          </IonButtons>
          <IonTitle>Registrar tu cara</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonNote className="ion-margin-start">
          <IonText>
            Necesitamos registrar tu cara una sola vez para que puedas marcar después con solo mirar
            a la cámara. Mantén el rostro centrado y bien iluminado.
          </IonText>
        </IonNote>

        {submitting ? (
          <div className="ion-text-center ion-padding">
            <IonNote>{done ? 'Listo.' : 'Enviando…'}</IonNote>
          </div>
        ) : (
          <FaceCapture
            onCapture={handleCapture}
            onError={(e) =>
              present({ message: e.message, duration: 3500, color: 'danger' }).catch(() => {})
            }
          />
        )}

        <IonButton
          expand="block"
          fill="outline"
          className="ion-margin-top"
          onClick={() => history.goBack()}
          disabled={submitting}
        >
          Cancelar
        </IonButton>
      </IonContent>
    </IonPage>
  )
}
