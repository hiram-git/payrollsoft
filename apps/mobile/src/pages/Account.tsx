import { useAuth } from '@/contexts/AuthContext'
import { type QueuedPunch, punchQueue } from '@/lib/offline-queue'
/**
 * Cuenta / sesión. Muestra el modo y el tenant activos, el estado de la
 * cola offline y permite forzar reintento o cerrar sesión.
 */
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react'
import { useEffect, useState } from 'react'
import { useHistory } from 'react-router-dom'

const MODE_LABELS: Record<string, string> = {
  employee: 'Empleado',
  kiosk: 'Kiosko',
  supervisor: 'Supervisor',
}

export default function Account() {
  const { mode, tenant, session, logout } = useAuth()
  const history = useHistory()
  const [present] = useIonToast()
  const [queue, setQueue] = useState<QueuedPunch[]>([])

  useEffect(() => punchQueue.subscribe(setQueue), [])

  const pending = queue.filter((i) => i.status === 'pending').length
  const failed = queue.filter((i) => i.status === 'failed').length

  async function retry() {
    const { sent, remaining } = await punchQueue.flush()
    await present({
      message: `Enviadas: ${sent}. Pendientes: ${remaining}.`,
      duration: 2500,
      color: remaining > 0 ? 'warning' : 'success',
    })
  }

  async function handleLogout() {
    await logout()
    history.replace('/')
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Cuenta</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonList inset>
          <IonListHeader>
            <IonLabel>Sesión</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>Modo</IonLabel>
            <IonText slot="end">{mode ? MODE_LABELS[mode] : '—'}</IonText>
          </IonItem>
          <IonItem>
            <IonLabel>Tenant</IonLabel>
            <IonText slot="end">{tenant}</IonText>
          </IonItem>
          {session?.name && (
            <IonItem>
              <IonLabel>Empleado</IonLabel>
              <IonText slot="end">{session.name}</IonText>
            </IonItem>
          )}
        </IonList>

        <IonList inset>
          <IonListHeader>
            <IonLabel>Cola offline</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>Pendientes</IonLabel>
            <IonText slot="end">{pending}</IonText>
          </IonItem>
          <IonItem>
            <IonLabel>Fallidas (4xx)</IonLabel>
            <IonText slot="end">{failed}</IonText>
          </IonItem>
        </IonList>
        {failed > 0 && (
          <IonNote color="danger" className="ion-margin-start">
            Hay marcaciones rechazadas por el servidor. Revísalas con RR. HH.
          </IonNote>
        )}

        <IonButton expand="block" fill="outline" className="ion-margin-top" onClick={retry}>
          Reintentar envíos
        </IonButton>
        <IonButton expand="block" color="danger" className="ion-margin-top" onClick={handleLogout}>
          Cerrar sesión
        </IonButton>
      </IonContent>
    </IonPage>
  )
}
