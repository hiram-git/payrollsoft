import { useAuth } from '@/contexts/AuthContext'
/**
 * STUB de login de supervisor (usuario tenant).
 *
 * TODO: autenticar contra POST /auth/login (email + password) y guardar
 * el JWT como Bearer. Bloqueado por el gap de Bearer del backend (mismo
 * que el empleado). El formulario está esbozado y deshabilitado para
 * dejar clara la forma de auth correcta. Ver NOTES.md.
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

export default function SupervisorLogin() {
  void useAuth() // reservado: aquí irá loginSupervisor cuando exista Bearer
  const [present] = useIonToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleLogin() {
    await present({
      message:
        'Modo Supervisor pendiente: requiere Bearer auth en el backend (POST /auth/login). Ver NOTES.md.',
      duration: 4000,
      color: 'warning',
    })
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/" />
          </IonButtons>
          <IonTitle>Supervisor</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonNote color="warning" className="ion-margin-start">
          ⚠️ Stub no funcional. Esbozo de la auth de usuario tenant.
        </IonNote>
        <IonList inset>
          <IonItem>
            <IonInput
              label="Correo"
              labelPlacement="floating"
              type="email"
              value={email}
              onIonInput={(e) => setEmail(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Contraseña"
              labelPlacement="floating"
              type="password"
              value={password}
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
            />
          </IonItem>
        </IonList>
        <IonButton expand="block" className="ion-margin-top" onClick={handleLogin}>
          Iniciar sesión (no disponible)
        </IonButton>
      </IonContent>
    </IonPage>
  )
}
