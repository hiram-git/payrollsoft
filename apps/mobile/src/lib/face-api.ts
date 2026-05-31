/**
 * Carga lazy de face-api (@vladmandic/face-api) y los modelos ONNX
 * servidos desde `/face-models/*` (apps/mobile/public/face-models).
 *
 * Espeja el patrón del kiosk web (apps/web/src/pages/kiosk/index.astro):
 *   - `tinyFaceDetector`  para detectar caras (rápido, ~190 KB)
 *   - `faceLandmark68Net` para landmarks (necesarios para el embedding)
 *   - `faceRecognitionNet` para el embedding de 128 dim
 *
 * Los modelos pesan ~7 MB en total; viven en `public/` para que Capacitor
 * los empaquete dentro del APK (no hacen falta requests de red).
 *
 * TypeScript: face-api.esm.js no trae types empaquetables; se declara una
 * interfaz mínima con lo que el flujo del móvil usa.
 */

const MODELS_BASE = '/face-models'
const FACEAPI_ESM = '/face-models/face-api.esm.js'

export type FaceLandmarks = {
  /** Estimación de "ojos abiertos" — se usa para liveness simple. */
  positions: Array<{ x: number; y: number; _x?: number; _y?: number }>
}

export type FaceDetection = {
  detection: {
    score: number
    box: { x: number; y: number; width: number; height: number }
  }
  landmarks: FaceLandmarks
  /** Embedding 128-dim. */
  descriptor: Float32Array
}

type TinyOptionsCtor = new (opts: { inputSize: number; scoreThreshold: number }) => unknown

type DetectChain = {
  withFaceLandmarks(): {
    withFaceDescriptor(): Promise<FaceDetection | undefined>
  }
}

export type FaceApi = {
  nets: {
    tinyFaceDetector: { loadFromUri(url: string): Promise<void> }
    faceLandmark68Net: { loadFromUri(url: string): Promise<void> }
    faceRecognitionNet: { loadFromUri(url: string): Promise<void> }
  }
  TinyFaceDetectorOptions: TinyOptionsCtor
  detectSingleFace(input: HTMLVideoElement | HTMLCanvasElement, opts: unknown): DetectChain
}

let cached: Promise<FaceApi> | null = null

/**
 * Carga face-api + sus tres modelos. Se cachea: llamadas posteriores
 * devuelven la misma promesa resuelta.
 */
export function loadFaceApi(): Promise<FaceApi> {
  if (cached) return cached
  cached = (async () => {
    // @vite-ignore: el path es absoluto y va al asset servido en runtime,
    // no a un módulo del grafo de Vite.
    const mod = (await import(/* @vite-ignore */ FACEAPI_ESM)) as unknown as FaceApi
    await mod.nets.tinyFaceDetector.loadFromUri(MODELS_BASE)
    await mod.nets.faceLandmark68Net.loadFromUri(MODELS_BASE)
    await mod.nets.faceRecognitionNet.loadFromUri(MODELS_BASE)
    return mod
  })()
  return cached
}

/**
 * Estimación pasiva de liveness por variancia de apertura ocular (EAR):
 * si el sujeto está vivo, la apertura cambia de frame a frame (parpadeo);
 * una foto plana mantiene la apertura constante. Devuelve un score 0..1.
 *
 * Reproduce la lógica del kiosk web (`pushLiveness`).
 */
export function createLivenessTracker() {
  const buf: number[] = []
  const MAX = 30

  function eyeAspectRatio(positions: FaceLandmarks['positions'], offset: number): number {
    // 6 puntos por ojo en el orden de face-api: superior-izq, sup-medio,
    // sup-der, inf-der, inf-medio, inf-izq. EAR = (|p1-p5| + |p2-p4|) / (2*|p0-p3|).
    const p = (i: number) => positions[offset + i]
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)
    const v1 = dist(p(1), p(5))
    const v2 = dist(p(2), p(4))
    const h = dist(p(0), p(3))
    if (h === 0) return 0
    return (v1 + v2) / (2 * h)
  }

  return {
    push(landmarks: FaceLandmarks): number {
      const left = eyeAspectRatio(landmarks.positions, 36)
      const right = eyeAspectRatio(landmarks.positions, 42)
      buf.push((left + right) / 2)
      if (buf.length > MAX) buf.shift()
      if (buf.length < 5) return 0
      const min = Math.min(...buf)
      const max = Math.max(...buf)
      return Math.min(1, (max - min) / 0.1)
    },
    reset() {
      buf.length = 0
    },
  }
}

/**
 * Inicia la cámara frontal y devuelve el `MediaStream` + un elemento
 * `<video>` configurado y ya con frames disponibles.
 */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
    audio: false,
  })
  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  await video.play().catch(() => {})
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) resolve()
    else video.addEventListener('loadeddata', () => resolve(), { once: true })
  })
  return stream
}

export function stopCamera(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}
