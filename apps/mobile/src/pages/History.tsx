import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api-client'
import { listTodayPunches } from '@/lib/attendance-service'
import { PUNCH_TYPE_LABELS, type PunchType, type UnifiedPunch } from '@/types/domain'
/**
 * Historial de marcaciones del día (GET /attendance/punches?date=hoy).
 * En modo empleado filtra por su propio employeeId; en kiosko lista todo.
 */
import {
  IonBadge,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import type { RefresherCustomEvent } from '@ionic/react'
import { useCallback, useEffect, useState } from 'react'

function punchLabel(type: number): string {
  return PUNCH_TYPE_LABELS[type as PunchType] ?? 'Desconocido'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('es-PA')
}

export default function History() {
  const { mode, session } = useAuth()
  const [punches, setPunches] = useState<UnifiedPunch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const employeeId = mode === 'employee' ? session?.employeeId : undefined
      setPunches(await listTodayPunches(employeeId))
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [mode, session])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRefresh(e: RefresherCustomEvent) {
    await load()
    await e.detail.complete()
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Historial de hoy</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner />
          </div>
        ) : error ? (
          <IonNote color="danger" className="ion-padding">
            {error}
          </IonNote>
        ) : punches.length === 0 ? (
          <IonNote className="ion-padding">Sin marcaciones registradas hoy.</IonNote>
        ) : (
          <IonList>
            {punches.map((p) => (
              <IonItem key={p.id}>
                <IonLabel>
                  <h2>{punchLabel(p.punchType)}</h2>
                  <p>
                    {formatTime(p.punchedAt)}
                    {p.employeeName ? ` · ${p.employeeName}` : ''}
                  </p>
                </IonLabel>
                <IonText slot="end">
                  <IonBadge color="medium">{p.source}</IonBadge>
                </IonText>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  )
}
