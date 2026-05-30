import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api-client'
/**
 * Login de empleado contra POST /portal/auth/login (cédula + contraseña).
 *
 * Funcional salvo el gap de Bearer del backend: si el login es válido
 * pero no llega token, se entra en "modo limitado" y se avisa al usuario
 * (las lecturas autenticadas darán 401 hasta que el backend entregue el
 * token — ver NOTES.md).
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

export default function EmployeeLogin() {
  const { loginEmployee } = useAuth()
  const history = useHistory()
  const [present] = useIonToast()
  const [idNumber, setIdNumber] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    try {
      const { bearerMissing } = await loginEmployee(idNumber, password)
      if (bearerMissing) {
        await present({
          message:
            'Login validado, pero el backend aún no entrega token Bearer. Sesión en modo limitado (ver NOTES.md).',
          duration: 4000,
          color: 'warning',
        })
      }
      history.replace('/app/punch')
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'No se pudo iniciar sesión'
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
          <IonTitle>Empleado</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonList inset>
          <IonItem>
            <IonInput
              label="Cédula"
              labelPlacement="floating"
              value={idNumber}
              autocomplete="username"
              onIonInput={(e) => setIdNumber(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Contraseña"
              labelPlacement="floating"
              type="password"
              value={password}
              autocomplete="current-password"
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
            />
          </IonItem>
        </IonList>
        <IonNote className="ion-margin-start">
          La empresa se detecta automáticamente a partir de tu cédula.
        </IonNote>
        <IonButton
          expand="block"
          className="ion-margin-top"
          disabled={loading || !idNumber || !password}
          onClick={handleLogin}
        >
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
        </IonButton>
      </IonContent>
    </IonPage>
  )
}
