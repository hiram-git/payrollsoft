import { useAuth } from '@/contexts/AuthContext'
/**
 * Login de kiosko. El dispositivo se autentica con su apiToken (el que
 * devuelve UNA sola vez la creación del device en /attendance/devices).
 *
 * Es la vía funcional end-to-end hoy: el backend acepta X-Device-Token
 * en POST /attendance/punches. La identificación del empleado concreto
 * (facial / NFC) queda como TODO en la pantalla de captura.
 */
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react'
import { useState } from 'react'
import { useHistory } from 'react-router-dom'

export default function KioskLogin() {
  const { loginKiosk, tenant } = useAuth()
  const history = useHistory()
  const [present] = useIonToast()
  const [deviceToken, setDeviceToken] = useState('')
  const [tenantSlug, setTenantSlug] = useState(tenant)
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    try {
      await loginKiosk(deviceToken, tenantSlug)
      history.replace('/app/punch')
    } catch (err) {
      await present({
        message: err instanceof Error ? err.message : 'No se pudo activar el kiosko',
        duration: 3500,
        color: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/" />
          </IonButtons>
          <IonTitle>Kiosko</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonList inset>
          <IonItem>
            <IonInput
              label="Tenant (slug)"
              labelPlacement="floating"
              value={tenantSlug}
              onIonInput={(e) => setTenantSlug(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Token del dispositivo"
              labelPlacement="floating"
              value={deviceToken}
              onIonInput={(e) => setDeviceToken(e.detail.value ?? '')}
            />
          </IonItem>
        </IonList>
        <IonNote className="ion-margin-start">
          El token se genera al crear el dispositivo (tipo de conexión <code>api</code>) en la
          consola web → Asistencia → Dispositivos.
        </IonNote>
        <IonButton
          expand="block"
          className="ion-margin-top"
          disabled={loading || !deviceToken || !tenantSlug}
          onClick={handleLogin}
        >
          {loading ? 'Activando…' : 'Activar kiosko'}
        </IonButton>
      </IonContent>
    </IonPage>
  )
}
