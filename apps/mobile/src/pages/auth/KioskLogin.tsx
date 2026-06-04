import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api-client'
/**
 * Login de kiosko. El dispositivo lo activa un usuario tenant con permiso
 * `facial:mark` (mismo modelo que el kiosk web). Tras autenticarse, el
 * dispositivo queda listo para que CUALQUIER empleado marque con su cédula
 * + verificación facial 1:1.
 *
 * Requiere el slug de la empresa porque /auth/login es por tenant.
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState(tenant)
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    try {
      const { bearerMissing } = await loginKiosk(email, password, tenantSlug)
      if (bearerMissing) {
        await present({
          message:
            'Sesión validada pero el backend no entregó token. Revisa que /auth/login devuelva el token (X-Client: mobile).',
          duration: 4000,
          color: 'warning',
        })
        setLoading(false)
        return
      }
      history.replace('/app/punch')
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'No se pudo activar el kiosko'
      await present({ message, duration: 3500, color: 'danger' })
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
              label="Empresa (slug)"
              labelPlacement="floating"
              value={tenantSlug}
              onIonInput={(e) => setTenantSlug(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Correo del operador"
              labelPlacement="floating"
              type="email"
              autocomplete="username"
              value={email}
              onIonInput={(e) => setEmail(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Contraseña"
              labelPlacement="floating"
              type="password"
              autocomplete="current-password"
              value={password}
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
            />
          </IonItem>
        </IonList>
        <IonNote className="ion-margin-start">
          Inicia con un usuario de la empresa que tenga permiso de marcación facial (
          <code>facial:mark</code>). El dispositivo quedará activo para que los empleados marquen
          con su cédula.
        </IonNote>
        <IonButton
          expand="block"
          className="ion-margin-top"
          disabled={loading || !email || !password || !tenantSlug}
          onClick={handleLogin}
        >
          {loading ? 'Activando…' : 'Activar kiosko'}
        </IonButton>
      </IonContent>
    </IonPage>
  )
}
