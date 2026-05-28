import { useAuth } from '@/contexts/AuthContext'
import Account from '@/pages/Account'
import FacialCapture from '@/pages/FacialCapture'
import History from '@/pages/History'
import ModeSelect from '@/pages/ModeSelect'
import Punch from '@/pages/Punch'
import EmployeeLogin from '@/pages/auth/EmployeeLogin'
import KioskLogin from '@/pages/auth/KioskLogin'
import SupervisorLogin from '@/pages/auth/SupervisorLogin'
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonSpinner,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
} from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'
import { fingerPrintOutline, personCircleOutline, timeOutline, todayOutline } from 'ionicons/icons'
import { Redirect, Route } from 'react-router-dom'

setupIonicReact()

function AppTabs() {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/app/punch" component={Punch} />
        <Route exact path="/app/history" component={History} />
        <Route exact path="/app/facial" component={FacialCapture} />
        <Route exact path="/app/account" component={Account} />
        <Route exact path="/app">
          <Redirect to="/app/punch" />
        </Route>
      </IonRouterOutlet>
      <IonTabBar slot="bottom">
        <IonTabButton tab="punch" href="/app/punch">
          <IonIcon icon={todayOutline} aria-hidden="true" />
          <IonLabel>Marcar</IonLabel>
        </IonTabButton>
        <IonTabButton tab="history" href="/app/history">
          <IonIcon icon={timeOutline} aria-hidden="true" />
          <IonLabel>Historial</IonLabel>
        </IonTabButton>
        <IonTabButton tab="facial" href="/app/facial">
          <IonIcon icon={fingerPrintOutline} aria-hidden="true" />
          <IonLabel>Facial</IonLabel>
        </IonTabButton>
        <IonTabButton tab="account" href="/app/account">
          <IonIcon icon={personCircleOutline} aria-hidden="true" />
          <IonLabel>Cuenta</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  )
}

export default function App() {
  const { ready, isAuthenticated } = useAuth()

  if (!ready) {
    return (
      <IonApp>
        <div className="ion-text-center" style={{ paddingTop: '40vh' }}>
          <IonSpinner />
        </div>
      </IonApp>
    )
  }

  return (
    <IonApp>
      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/">
            {isAuthenticated ? <Redirect to="/app/punch" /> : <ModeSelect />}
          </Route>
          <Route exact path="/login/employee" component={EmployeeLogin} />
          <Route exact path="/login/kiosk" component={KioskLogin} />
          <Route exact path="/login/supervisor" component={SupervisorLogin} />
          <Route path="/app">{isAuthenticated ? <AppTabs /> : <Redirect to="/" />}</Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  )
}
