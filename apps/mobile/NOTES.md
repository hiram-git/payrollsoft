# NOTES — integración móvil ↔ backend

Estado de los cambios de backend que el móvil necesitaba. Los puntos 1–4
y el de CSRF ya están **implementados** en `apps/api`. El punto de
almacenamiento seguro es del lado móvil y sigue pendiente.

---

## 1. Bearer auth en las rutas — ✅ IMPLEMENTADO

`authPlugin` (`apps/api/src/middleware/auth.ts`) ahora lee el token de la
**cookie `auth`** o, como fallback, del header **`Authorization: Bearer`**:

```ts
const bearer = headers.authorization?.replace(/^Bearer\s+/i, '')
const token = cookie.auth?.value ?? bearer
```

Esto habilita a los clientes nativos (sin cookies httpOnly) en cualquier
ruta que use `authPlugin`. El móvil envía `Authorization: Bearer <jwt>`
desde `src/lib/api-client.ts`.

---

## 2. Login devuelve el JWT en el body — ✅ IMPLEMENTADO

`POST /portal/auth/login` y `POST /auth/login` ahora incluyen el `token`
en `data` **solo cuando el request trae el header `X-Client: mobile`**.
El navegador (BFF web) nunca envía ese header, así que el JWT **nunca se
expone a JS en el navegador** (sigue usando la cookie httpOnly).

`/portal/auth/login` además devuelve `data.tenantSlug` (el tenant real
resuelto por el backend al buscar la cédula entre todos los tenants), para
que el móvil lo fije como `X-Tenant` y los requests siguientes pasen
`guardTenantMatchesToken`. El móvil lo consume en `src/lib/auth-service.ts`.

> El móvil marca todos sus requests con `X-Client: mobile` (ver
> `src/lib/api-client.ts`).

---

## 3. Forma del JWT de empleado en `POST /attendance/punches` — ✅ IMPLEMENTADO

`AuthUser` ahora admite `type: 'employee'` con `employeeId`/`employeeCode`.
El **Modo 2** de `punch-routes.ts` resuelve el id del portador según el
tipo de token y solo permite marcar para sí mismo:

```ts
const tokenEmployeeId = user.type === 'employee' ? user.employeeId : user.userId
if (!tokenEmployeeId || body.employeeId !== tokenEmployeeId) { /* 403 */ }
```

Además, `GET /attendance/punches` (`unified-routes.ts`) ahora permite a un
token de empleado leer **solo sus propias** marcaciones (se ignora el
`employeeId` del query y se fuerza el del token); los usuarios tenant
siguen requiriendo `attendance:read`.

---

## 4. CORS + CSRF para orígenes Capacitor — ✅ IMPLEMENTADO

Se centralizó la lista de orígenes de confianza en
`apps/api/src/config/origins.ts` (`isAllowedOrigin`), consumida por:

- **CORS** (`index.ts`): refleja el origin si es de confianza y permite
  los headers `Authorization`, `X-Device-Token`, `X-Client` además de
  `Content-Type` y `X-Tenant`.
- **CSRF** (`middleware/csrf.ts`): antes solo aceptaba `WEB_URL`, lo que
  habría bloqueado los POST del móvil (el WebView de Capacitor sí manda
  `Origin`). Ahora acepta cualquier origin de confianza.

Orígenes permitidos: `WEB_URL`, esquemas nativos (`capacitor://localhost`,
`ionic://localhost`, `http(s)://localhost`), cualquier `localhost:<puerto>`
en desarrollo, y los que se añadan por la variable **`MOBILE_ORIGINS`**
(coma-separados; útil para el dev server del móvil, p.ej.
`http://localhost:5173`).

---

## 5. Endpoint de punch individual — ✅ ya existía

`POST /attendance/punches` soporta los dos modos del móvil: empleado
(Bearer, puntos 1–3) y kiosko (`X-Device-Token`). No se necesitó endpoint
nuevo.

---

## 6. Almacenamiento seguro del token — ⏳ PENDIENTE (lado móvil)

El móvil guarda el token con **Capacitor Preferences**, que **no está
cifrado**. Para producción debe migrarse a Keychain (iOS) / Keystore
(Android) vía un plugin seguro. Centralizado en `src/lib/storage.ts` para
que el cambio sea de un solo archivo. No depende del backend.

---

## 7. Subpath export aditivo en `packages/db` — ✅ IMPLEMENTADO

`packages/db/package.json` expone `"./schema/*"` para importar los tipos
de fila derivados de Drizzle sin arrastrar el barrel. Cambio aditivo; no
afecta a `apps/api` ni `apps/web`.

---

## Modo Supervisor — auth desbloqueada, flujo pendiente

`POST /auth/login` ya devuelve el token para el móvil (punto 2), así que
la **autenticación** de supervisor está desbloqueada. El **flujo de
marcación supervisada** (manual, vía `POST /facial/marcaciones/manual`)
sigue como `TODO` en la app — es una feature aparte, no solo auth.

---

## Reconocimiento facial — implementado, con TODOs

**Implementado:**

- Backend: nuevos endpoints `/portal/facial/{me, enroll, match, marcaciones}`
  con auth de empleado (JWT del portal), `employeeId` siempre del JWT,
  clasificación automática por secuencia diaria (1ª = entry, 2ª =
  lunch_start, 3ª = lunch_end, 4ª = exit, 5+ = extra), consolidación
  eager después de cada inserción.
- Móvil: pantalla `FaceEnroll` (auto-enrolamiento), pantalla `Punch`
  reescrita con un solo botón "Marcar con cara"; carga lazy de face-api +
  modelos empaquetados en el APK; liveness por parpadeo; al capturar →
  match anti-fraude → registro.

**Estado de los TODOs:**

1. **Modo Kiosko facial.** ✅ IMPLEMENTADO. El kiosko se autentica con un
   usuario tenant (`facial:mark`), el empleado se identifica por cédula
   (`GET /facial/kiosk/employee`) y la cara se verifica 1:1
   (`POST /facial/kiosk/mark`). El backend clasifica el `kind` por
   secuencia diaria, igual que el modo empleado. (Se eligió 1:1 sobre la
   búsqueda 1:N del kiosk web para evitar falsos positivos en dispositivos
   compartidos.)
2. **Offline para marcación facial.** ❌ DESCARTADO por decisión de
   producto. El flujo facial requiere conexión (el match vive en el
   backend); si no hay red se rechaza con un mensaje claro y no se
   implementará modo offline.
3. **Re-enrolamiento desde otra cuenta / gestión multiusuario.** ❌
   DESCARTADO. El modelo de uso es **un empleado por empresa**, así que no
   hace falta gestión de re-enrolamiento desde una cuenta administrativa
   ni flujos multiusuario de enrolamiento. El enrolamiento inicial del
   propio empleado (modo Empleado → "Registrar mi cara") es suficiente.
4. **Política de liveness más fuerte.** Opcional. El liveness por parpadeo
   (EAR) es pasivo y simple — vulnerable a fotos animadas. Para entornos
   sensibles podría agregarse MiniFASNet u otra red anti-spoofing.
