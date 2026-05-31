# Foto del colaborador ↔ enrolamiento facial

> Estado: **enrolamiento real desde la foto, implementado** (Fase 2.F).
> El descriptor biométrico se calcula en el navegador a partir de la foto y
> se guarda como enrolamiento.

## Cómo funciona

1. La foto del colaborador (`employees.photo`, base64) se carga y valida en el
   formulario (PNG/JPEG/WEBP, ≤500 KB) — Fase 2.D.
2. En la tarjeta "Foto y cédula" del formulario de empleado aparece el botón
   **"Enrolar rostro desde la foto"**.
3. Al pulsarlo, el navegador importa **face-api.js** y los modelos desde
   `/face-models/` — exactamente la misma librería y modelos que usa el kiosko
   (`apps/web/src/pages/kiosk/*.astro`) — detecta el rostro sobre un `<img>`,
   calcula el **descriptor de 128 dimensiones** y su `qualityScore`.
4. El descriptor se envía al proxy same-origin
   `apps/web/src/pages/api/facial/enrollments.ts`, que reenvía a
   `POST /facial/enrollments` con auth + tenant.
5. `createEnrollmentService` (`facial/service.ts`) persiste el enrolamiento
   como `isPrimary` y desactiva el primario anterior. El mismo embedding lo
   consume `matchEmbeddingService` cuando el kiosko marca asistencia.

## Por qué client-side y no server-side

El embedding se produce con face-api.js en el navegador (igual que en el
kiosko). No se añadió IA ni dependencias nuevas en el servidor: el descriptor
de 128-d es idéntico en formato al que genera el kiosko, así que
`searchSimilarEmbeddings` lo compara sin cambios.

## Notas

- Requiere permiso `facial:enroll` (igual que el flujo del kiosko).
- La foto debe ser frontal y nítida; si no se detecta rostro, el botón avisa y
  no crea enrolamiento.
- El enrolamiento por kiosko en vivo (`/kiosk/setup?enroll=<id>`, 3 muestras
  promediadas) sigue disponible y suele dar mejor calidad que una sola foto.
