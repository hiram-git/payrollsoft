import type { AppMode } from '@/types/domain'
/**
 * Pantalla de selección de modo. Punto de entrada cuando no hay sesión.
 */
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import { businessOutline, personOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { useHistory } from 'react-router-dom'

const MODES: { mode: AppMode; title: string; subtitle: string; icon: string; path: string }[] = [
  {
    mode: 'employee',
    title: 'Empleado',
    subtitle: 'Marca tu propia asistencia desde tu teléfono',
    icon: personOutline,
    path: '/login/employee',
  },
  {
    mode: 'kiosk',
    title: 'Kiosko',
    subtitle: 'Dispositivo compartido fijo para marcar a varios empleados',
    icon: businessOutline,
    path: '/login/kiosk',
  },
  {
    mode: 'supervisor',
    title: 'Supervisor',
    subtitle: 'Marcación manual supervisada y aprobaciones',
    icon: shieldCheckmarkOutline,
    path: '/login/supervisor',
  },
]

export default function ModeSelect() {
  const history = useHistory()

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>RCG SOFTRIX Marcaciones</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardSubtitle>Selecciona un modo</IonCardSubtitle>
            <IonCardTitle>¿Cómo vas a usar este dispositivo?</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonList>
              {MODES.map((m) => (
                <IonItem key={m.mode} button detail onClick={() => history.push(m.path)}>
                  <IonIcon slot="start" icon={m.icon} aria-hidden="true" />
                  <IonLabel>
                    <h2>{m.title}</h2>
                    <p>{m.subtitle}</p>
                  </IonLabel>
                </IonItem>
              ))}
            </IonList>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  )
}
