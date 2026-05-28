/**
 * Captura facial — SOLO ESQUELETO.
 *
 * Integra el plugin de cámara de Capacitor para tomar una foto y
 * mostrarla. El enrolamiento/identificación facial (POST /facial/* y el
 * matching con embeddings de 128 dim) NO se implementa en esta
 * iteración: ver el TODO marcado abajo.
 */
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonImg,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react'
import { useState } from 'react'

export default function FacialCapture() {
  const [present] = useIonToast()
  const [photo, setPhoto] = useState<string | null>(null)

  async function capture() {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      })
      setPhoto(image.dataUrl ?? null)

      // ───────────────────────────────────────────────────────────────
      // TODO (próxima iteración): a partir de la foto capturada,
      //   1. extraer el embedding facial (128 dim) con face-api,
      //   2. POST /facial/marcaciones (identificación) o
      //      POST /facial/enrollments (enrolamiento), según el flujo,
      //   3. consumir GET /facial/enrollments para precargar plantillas.
      // No se implementa el matching facial en esta iteración.
      // ───────────────────────────────────────────────────────────────
      await present({
        message: 'Foto capturada. El matching facial está pendiente (TODO).',
        duration: 2500,
        color: 'medium',
      })
    } catch (err) {
      // Cancelar la cámara también entra aquí: no es un error de la app.
      await present({
        message: err instanceof Error ? err.message : 'Captura cancelada',
        duration: 2000,
        color: 'medium',
      })
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Captura facial</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardSubtitle>Esqueleto</IonCardSubtitle>
            <IonCardTitle>Reconocimiento facial</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonNote>
              El enrolamiento e identificación facial (<code>/facial/*</code>) se implementarán en
              una iteración posterior. Por ahora solo se valida la integración de cámara.
            </IonNote>
            {photo && <IonImg src={photo} alt="Captura" className="ion-margin-top" />}
            <IonButton expand="block" className="ion-margin-top" onClick={capture}>
              Tomar foto
            </IonButton>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  )
}
