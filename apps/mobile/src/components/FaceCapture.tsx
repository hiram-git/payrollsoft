import {
  type FaceApi,
  type FaceDetection,
  createLivenessTracker,
  loadFaceApi,
  startCamera,
  stopCamera,
} from '@/lib/face-api'
/**
 * Componente de captura facial reutilizable.
 *
 * Inicializa la cámara frontal y face-api, dibuja el frame en un canvas,
 * detecta caras en bucle y, cuando hay una cara con buen score y liveness
 * suficiente, llama a `onCapture` con el embedding 128-dim. Después se
 * detiene automáticamente.
 *
 * El consumidor decide qué hacer con el embedding (enrolar o marcar).
 */
import { IonNote, IonSpinner } from '@ionic/react'
import { useEffect, useRef, useState } from 'react'

export type CapturedFace = {
  descriptor: Float32Array
  score: number
  liveness: number
}

type Props = {
  /** Score mínimo del detector (0..1). Default 0.7. */
  minScore?: number
  /** Liveness mínimo (0..1). 0 desactiva la verificación. Default 0.5. */
  minLiveness?: number
  /** Se llama una sola vez al capturar la primera cara que cumple los umbrales. */
  onCapture: (face: CapturedFace) => void
  /** Se llama si hubo un error de cámara/permiso o cargando los modelos. */
  onError?: (err: Error) => void
}

export default function FaceCapture({
  minScore = 0.7,
  minLiveness = 0.5,
  onCapture,
  onError,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stoppedRef = useRef(false)
  // Props "vivas" expuestas como refs: el useEffect arranca una sola vez
  // (cámara + modelos) y lee siempre el valor más reciente sin re-ejecutarse.
  const minScoreRef = useRef(minScore)
  const minLivenessRef = useRef(minLiveness)
  const onCaptureRef = useRef(onCapture)
  const onErrorRef = useRef(onError)
  minScoreRef.current = minScore
  minLivenessRef.current = minLiveness
  onCaptureRef.current = onCapture
  onErrorRef.current = onError
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hint, setHint] = useState<string>('Cargando modelos…')

  useEffect(() => {
    let faceapi: FaceApi | null = null
    const liveness = createLivenessTracker()

    async function run() {
      try {
        faceapi = await loadFaceApi()
        if (stoppedRef.current) return
        setHint('Activando cámara…')
        const video = videoRef.current
        if (!video) throw new Error('Elemento de video no disponible')
        streamRef.current = await startCamera(video)
        if (stoppedRef.current) return
        setStatus('ready')
        setHint('Mira a la cámara y parpadea')

        const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d') ?? null

        async function tick() {
          if (stoppedRef.current || !faceapi || !video) return
          if (video.readyState >= 2 && canvas && ctx) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            const detection: FaceDetection | undefined = await faceapi
              .detectSingleFace(video, opts)
              .withFaceLandmarks()
              .withFaceDescriptor()
            if (detection) {
              const { box } = detection.detection
              ctx.lineWidth = 3
              ctx.strokeStyle = '#10b981'
              ctx.strokeRect(box.x, box.y, box.width, box.height)
              const liv = liveness.push(detection.landmarks)
              if (
                detection.detection.score >= minScoreRef.current &&
                liv >= minLivenessRef.current
              ) {
                stoppedRef.current = true
                onCaptureRef.current({
                  descriptor: detection.descriptor,
                  score: detection.detection.score,
                  liveness: liv,
                })
                return
              }
            } else {
              liveness.reset()
            }
          }
          requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        const e = err instanceof Error ? err : new Error('Error desconocido')
        setStatus('error')
        setHint(e.message)
        onErrorRef.current?.(e)
      }
    }
    run()

    return () => {
      stoppedRef.current = true
      stopCamera(streamRef.current)
      streamRef.current = null
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto' }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', borderRadius: 8, background: '#000' }}
      >
        <track kind="captions" />
      </video>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
      <div className="ion-text-center ion-margin-top">
        {status === 'loading' && <IonSpinner />}
        <IonNote color={status === 'error' ? 'danger' : 'medium'}>{hint}</IonNote>
      </div>
    </div>
  )
}
