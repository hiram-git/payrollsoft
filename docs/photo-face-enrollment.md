# Foto del colaborador ↔ enrolamiento facial

> Estado: **foto almacenada; enrolamiento biométrico diferido** (Fase 2.F,
> decisión F del diagnóstico). No se genera template desde la foto guardada.

## Qué hay hoy

- `employees.photo` (text, base64) se captura y valida en el formulario de
  empleado (PNG/JPEG/WEBP, ≤500 KB) — Fase 2.D. Se guarda como **referencia
  visual**.
- El módulo de reconocimiento facial **existe y está completo**
  (`apps/api/src/modules/facial/`): enrolamiento, matching por distancia
  coseno, ingesta de marcaciones, terminales/kioskos.
- `facialEnrollments` guarda un `embedding` (vector 128-d) + `photoUrl`
  opcional + `qualityScore`.

## Por qué no se enrola desde la foto

`createEnrollmentService` (`facial/service.ts`) recibe un **embedding ya
calculado** — el vector lo produce la **captura del kiosko** con el lector
facial, no existe un generador de embeddings server-side a partir del base64
almacenado en `employees.photo`. Generar un template biométrico desde una foto
arbitraria subida en el formulario daría matches de baja calidad y no es el
flujo del módulo.

## Punto de integración futura

Cuando se quiera enrolar desde la foto del formulario, el enganche va en
`createEmployeeService` / `updateEmployeeService`
(`apps/api/src/modules/employees/service.ts`), tras persistir `photo`:

```
// Pseudo — pendiente de un generador de embeddings server-side:
// const embedding = await generateFaceEmbedding(employee.photo)
// if (embedding) await createEnrollmentService(db, {
//   employeeId: employee.id, embedding, photoUrl: null,
//   qualityScore, isPrimary: true,
// }, performedByUserId)
```

Requisito bloqueante: un servicio que convierta imagen → embedding 128-d
compatible con `normaliseEmbedding` / `searchSimilarEmbeddings`. Mientras no
exista, el enrolamiento sigue por `/kiosk/setup?enroll=<id>`
(`apps/web/src/pages/attendance/enroll.astro`).
