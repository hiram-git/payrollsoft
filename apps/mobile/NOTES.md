# NOTES — cambios pendientes en el backend (NO implementados)

Estos son los cambios que detecté al integrar `apps/mobile` con la API
Elysia. **No los implementé** (la tarea pide no tocar `apps/api`); los
dejo documentados con el cambio mínimo necesario y el archivo afectado.
El móvil ya está cableado para funcionar el día que se apliquen.

---

## 1. Bearer auth en las rutas (BLOQUEANTE para modo Empleado/Supervisor)

**Hoy:** `authPlugin` (`apps/api/src/middleware/auth.ts`) solo lee el
token de la **cookie** `auth`:

```ts
.derive({ as: 'global' }, async ({ jwt, cookie }) => {
  const token = cookie.auth?.value
  ...
})
```

El docstring de `apps/api/src/modules/attendance/punch-routes.ts` afirma
que soporta `Authorization` header, pero el middleware **no lo lee**. Un
cliente nativo no usa cookies httpOnly, así que `Authorization: Bearer`
nunca se honra.

**Cambio mínimo:** en `authPlugin`, aceptar el header como fallback de la
cookie:

```ts
.derive({ as: 'global' }, async ({ jwt, cookie, headers }) => {
  const bearer = headers.authorization?.replace(/^Bearer\s+/i, '')
  const token = cookie.auth?.value ?? bearer
  ...
})
```

El móvil ya envía `Authorization: Bearer <jwt>` (ver
`src/lib/api-client.ts`).

---

## 2. `POST /portal/auth/login` debe devolver el JWT en el body (BLOQUEANTE)

**Hoy:** `apps/api/src/modules/portal/auth-routes.ts` firma el JWT y lo
setea **solo como cookie httpOnly** `portal_auth`; el body devuelve
`{ success, data: { employeeId, code, name } }` **sin el token**. Un
cliente nativo no puede leer la cookie httpOnly, así que se queda sin
credencial utilizable.

**Cambio mínimo:** incluir el token en la respuesta (idealmente solo
cuando el request no viene del navegador, p.ej. detectando ausencia de
`Origin` web o un header `X-Client: mobile`):

```ts
return {
  success: true,
  data: { employeeId: emp.id, code: emp.code, name: `${emp.firstName} ${emp.lastName}`, token },
}
```

El móvil ya está preparado: `loginEmployee` lee `data.token` si está
presente y lo guarda como Bearer; si no llega, entra en "modo limitado" y
avisa al usuario (ver `src/lib/auth-service.ts`).

> También aplicaría a `POST /auth/login` (usuario tenant) para habilitar
> el **modo Supervisor**.

---

## 3. Desajuste de forma del JWT de empleado vs. `POST /attendance/punches`

El JWT del portal lleva `type: 'employee'` y `employeeId` (no `userId`).
Pero el **Modo 2** de `apps/api/src/modules/attendance/punch-routes.ts`
asume un JWT de usuario tenant:

```ts
if (body.employeeId !== user.userId) { ... 403 ... }
```

y `guardTenantMatchesToken` espera un `user` con `tenantSlug`. Un token de
empleado del portal no encaja tal cual.

**Cambio mínimo:** reconocer también `type === 'employee'` en ese
handler, comparando contra `user.employeeId` en lugar de `user.userId`, y
ajustar el guard de tenant para empleados (el JWT del portal sí trae
`tenantSlug`). Sin esto, aunque el Bearer se acepte (punto 1), el empleado
no podría crear su propio punch.

---

## 4. CORS para orígenes Capacitor

**Hoy:** `apps/api/src/index.ts`:

```ts
cors({
  origin: env.WEB_URL,
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Tenant'],
})
```

El app nativo de Capacitor hace requests cross-origin desde
`capacitor://localhost` (iOS) y `http://localhost` (Android), y necesita
enviar `Authorization` y `X-Device-Token`.

**Cambio mínimo:** ampliar orígenes y headers permitidos:

```ts
cors({
  origin: [env.WEB_URL, 'capacitor://localhost', 'http://localhost', 'ionic://localhost'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Tenant', 'Authorization', 'X-Device-Token'],
})
```

---

## 5. Endpoint de punch individual — ✅ ya existe

`POST /attendance/punches` ya está implementado
(`apps/api/src/modules/attendance/punch-routes.ts`) y soporta los dos
modos que el móvil necesita:

- **Empleado**: JWT (pendiente puntos 1–3).
- **Kiosko**: header `X-Device-Token` con el `apiToken` del dispositivo
  → **funciona hoy mismo end-to-end** (no requiere cambios). El backend
  deriva el `source` del `connectionMethod` del device.

No se necesita endpoint nuevo.

---

## 6. Almacenamiento seguro del token (mejora, no bloqueante)

El móvil guarda el token con **Capacitor Preferences**, que **no está
cifrado** (UserDefaults / SharedPreferences en claro). Para producción
debe migrarse a Keychain (iOS) / Keystore (Android) vía un plugin seguro
(p.ej. `capacitor-secure-storage-plugin`). Está centralizado en
`src/lib/storage.ts` para que el cambio sea de un solo archivo.

---

## 7. Cambio que SÍ se aplicó en `packages/db` (mínimo y aditivo)

Para importar los tipos de fila derivados de Drizzle (`AttendancePunch`,
`AttendanceDevice`, ...) **sin duplicarlos**, el móvil necesita acceder a
los módulos de schema concretos. El barrel `@payroll/db` reexporta también
lógica de provisioning/seed que arrastraría todo el grafo del paquete (con
errores de tipos preexistentes) al typecheck del móvil.

Se añadió un **subpath export aditivo** en `packages/db/package.json`:

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./schema/*": "./src/schema/*.ts"   // ← añadido
}
```

No cambia el export `.` existente, así que `apps/api` y `apps/web` siguen
funcionando igual. El móvil importa, p.ej.,
`@payroll/db/schema/attendance-punches`.
