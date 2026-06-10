# Auditoría de Seguridad — `apps/api`

- **Alcance:** únicamente `apps/api` (Elysia + Drizzle). Se revisó `packages/db`
  solo en lo que afecta directamente la isolación de tenant de la API.
- **Fecha:** 2026-06-10
- **Tipo:** revisión estática (read-only). No se modificó código de la aplicación.
- **Modelo de aislamiento:** schema-per-tenant vía `search_path` de PostgreSQL
  (`packages/db/src/client.ts:25`).

> La remediación se hará en sesiones separadas. Este documento solo describe y
> clasifica. Cada hallazgo cita `archivo:línea` exacta.

---

## 1. Resumen ejecutivo

El aislamiento entre tenants se apoya en un esquema-por-tenant seleccionado por
`search_path`, lo cual es sólido cuando el `db` por-request se usa de forma
consistente. El hallazgo dominante es que **un gran número de grupos de rutas
sensibles (nómina, empleados, préstamos, asistencia, acumulados, posiciones,
catálogos, empresa, acreedores, dashboard, facial) NO aplican
`guardTenantMatchesToken`**, mientras que el `db` se resuelve desde el header
`X-Tenant` controlado por el cliente: cualquier usuario autenticado de un tenant
puede apuntar `X-Tenant` a otro tenant y operar sobre sus datos (salarios, PII,
cédulas) si posee el código de permiso correspondiente. En el portal del
colaborador se detectaron tokens de reseteo almacenados en texto plano, una
contraseña por defecto embebida en código (`172839`), y ausencia de rate-limit
en login/recuperación. La criptografía de contraseñas, el flujo de reseteo del
panel admin, la impersonación de super-admin (auditada, TTL corto) y las
consultas Drizzle parametrizadas están correctamente implementados. Dos
"hallazgos críticos" reportados por herramientas automáticas (inyección SQL en
`unified-service.ts` y fuerza bruta de token de dispositivo) se verificaron como
**falsos positivos**.

---

## 2. Hallazgos por severidad

### 🔴 CRÍTICO

#### C-1. Acceso cross-tenant por falta de `guardTenantMatchesToken` en rutas sensibles

- **Archivos / líneas (beforeHandle sin el guard):**
  - `apps/api/src/modules/payroll/routes.ts:67,96,121,141,159,180,201,222,243,264,285,299,313,335,359,389,420,441,464,491,516`
  - `apps/api/src/modules/employees/routes.ts:177,197,240,282,305,329`
  - `apps/api/src/modules/employees/loans/routes.ts:73,100,116,136`
  - `apps/api/src/modules/attendance/routes.ts:82,101,122,141,163,184,203,223,242,269`
  - `apps/api/src/modules/acumulados/routes.ts:57,81`
  - `apps/api/src/modules/positions/routes.ts:60,80,103,125`
  - `apps/api/src/modules/company/routes.ts:50,64`
  - `apps/api/src/modules/creditors/routes.ts:39,60,81,100`
  - `apps/api/src/modules/dashboard/routes.ts:20`
  - `apps/api/src/modules/facial/routes.ts:145,167,184,200,449` (y resto del archivo)
  - `apps/api/src/modules/catalogs/{budget-items,chart-of-accounts,concepts,departments,job-functions,job-titles}/routes.ts` (todas las rutas)
- **Mecanismo:** El plugin de tenant resuelve `db` desde el header `X-Tenant`
  (`apps/api/src/middleware/tenant.ts:13-24`): `db: tenantSlug ? getTenantDb(tenantSlug) : publicDb`.
  El JWT lleva su propio `tenantSlug` (`apps/api/src/modules/auth/service.ts:33-34`),
  pero `guardPermission` solo valida los permisos **embebidos en el JWT**
  (`apps/api/src/middleware/auth.ts:130-131`, lee `user.permissions`), sin
  comparar el tenant del token contra el tenant de la petición.
- **Impacto:** Un usuario autenticado del tenant A con, p.ej., `payroll:read`
  envía sus credenciales válidas con `X-Tenant: tenant_b`. `guardAuth` pasa
  (token válido), `guardPermission('payroll:read')` pasa (permiso del tenant A),
  y el handler ejecuta la consulta contra el schema del tenant B. Resultado:
  lectura/escritura cross-tenant de nómina, salarios, empleados, cédulas,
  préstamos, etc. Los slugs de tenant son fácilmente descubribles (subdominios,
  `GET /superadmin/tenants/check-slug/:slug`, enumeración en el login del
  portal), por lo que la barrera es baja. El aislamiento por `search_path` NO
  protege aquí porque el `db` ya apunta al schema del otro tenant.
- **Contraste (implementación correcta):** `treasury`, `vacations`,
  `time-balance`, `audit`, `reports`, `employees/dependents-routes.ts`,
  `portal/credentials-routes.ts` y `portal/facial-routes.ts` SÍ incluyen
  `guardTenantMatchesToken` (ver `apps/api/src/middleware/tenant.ts:40-62`).
- **Remediación recomendada:** Añadir `guardTenantMatchesToken` al `beforeHandle`
  de todas las rutas que dependan del `db` derivado del header. Idealmente,
  hacerlo cumplir por defecto a nivel de plugin/derivación (fail-closed): que el
  `db` por-request solo se exponga cuando el tenant del token coincide con el
  resuelto, y que las rutas super-admin lo soliciten explícitamente.

---

### 🟠 ALTO

#### A-1. Token de reseteo de contraseña del portal almacenado en texto plano

- **Archivo:línea:** `apps/api/src/modules/portal/auth-routes.ts:349-356` (generación
  y `UPDATE ... SET reset_token = ${token}`), `:416` (lookup por
  `reset_token = ${body.token}`), `:439` (limpieza).
- **Detalle:** El token (`${crypto.randomUUID()}-${crypto.randomUUID()}`) se guarda
  tal cual en `employee_credentials.reset_token`. Cualquier lectura de la BD
  (backup, dump, SQLi en otro punto, acceso de DBA) permite redimir resets de
  todos los colaboradores. Además, `/portal/auth/reset-password` (`:408-424`)
  recorre **todos los tenants** secuencialmente buscando el token, y
  `/portal/auth/forgot-password` (`:311-396`) no tiene rate-limit.
- **Impacto:** Robo de cuentas de portal; enumeración temporal por tenant.
- **Contraste correcto:** El flujo del panel admin SÍ hashea el token con SHA-256
  (`apps/api/src/modules/auth/password-reset-service.ts:36-38,83,118,137`),
  es de un solo uso e invalida pendientes. El portal debería replicar ese patrón.
- **Remediación:** Almacenar solo `sha256(token)`; comparar por hash; añadir
  rate-limit a `forgot-password`/`reset-password`; evitar el escaneo
  multi-tenant (resolver tenant del token o por slug explícito).

#### A-2. Contraseña por defecto embebida en código (`172839`)

- **Archivo:línea:** `apps/api/src/modules/portal/auth-routes.ts:30`
  (`const DEFAULT_PASSWORD = '172839'`), usada en `:114`;
  `apps/api/src/modules/portal/credentials-routes.ts:135` y `:250`
  (`const hash = await hp('172839')`).
- **Detalle:** En el primer login del portal, si el empleado no tiene credencial,
  se crea automáticamente con esta contraseña conocida
  (`auth-routes.ts:113-124`). Un atacante que conozca una cédula (dato
  semi-público) puede iniciar sesión como el colaborador **antes** de que este
  active su cuenta.
- **Impacto:** Toma de cuenta previa a la activación; acceso a datos personales y
  de nómina del colaborador en el portal.
- **Remediación:** Generar contraseña aleatoria por colaborador, forzar
  `must_change_password`, y no auto-crear credenciales en el login.

#### A-3. Login del portal sin rate-limit y con enumeración cross-tenant

- **Archivo:línea:** `apps/api/src/modules/portal/auth-routes.ts:87-240` (sin
  `beforeHandle`/`loginRateLimit`); `findEmployeeAcrossTenants` `:42-81`.
- **Detalle:** Solo hay bloqueo por cuenta tras 5 intentos
  (`MAX_FAILED_ATTEMPTS`, `:29,131-138`), pero ninguna limitación por IP. El
  login recorre todos los tenants activos buscando la cédula, lo que permite
  enumerar colaboradores a través de tenants y fuerza bruta distribuida sobre
  muchas cuentas.
- **Contraste:** El login admin sí aplica `loginRateLimit`
  (`apps/api/src/modules/auth/routes.ts:67,100`).
- **Remediación:** Añadir `loginRateLimit` (existe en
  `apps/api/src/middleware/rateLimit.ts:86`) al login/forgot/reset del portal.

#### A-4. Marcajes falsos / retrofechados (integridad de asistencia)

- **Archivo:línea:**
  - `apps/api/src/modules/attendance/punch-service.ts:20`
    (`const punchedAt = input.punchedAt ? new Date(input.punchedAt) : new Date()` — sin validar frescura).
  - `apps/api/src/modules/attendance/punch-routes.ts:43-66` (modo device-token:
    `employeeId` del body se confía sin vínculo dispositivo↔empleado; solo se
    valida que el empleado exista, `:50`).
  - `apps/api/src/modules/attendance/punch-routes.ts:90` (modo JWT empleado: el
    campo `source` lo provee el cliente y se acepta tal cual).
- **Detalle:** Con un token de dispositivo válido se puede inyectar un marcaje
  para **cualquier** `employeeId` con **cualquier** `punchedAt` (incluyendo
  fechas pasadas). En el modo JWT, el empleado solo puede marcar para sí mismo
  (`:81-88`, correcto), pero puede falsificar `source` para enturbiar la
  trazabilidad.
- **Impacto:** Fraude de asistencia (horas extra, puntualidad), afecta cálculos
  de nómina.
- **Nota:** El token de dispositivo en sí es robusto (32 bytes aleatorios,
  hash SHA-256 en BD — `attendance/devices-service.ts:58-60`,
  `punch-service.ts:50`), por lo que el riesgo es por diseño de confianza, no
  por debilidad del token.
- **Remediación:** Validar que `punchedAt` esté dentro de ±N minutos del reloj
  del servidor; vincular dispositivo↔empleado (NFC/biométrico); forzar `source`
  desde el servidor en el modo JWT.

---

### 🟡 MEDIO

#### M-1. Sin manejador global de errores; fuga de mensajes internos al cliente

- **Archivo:línea:** No existe `.onError(...)` en `apps/api/src/index.ts:52-145`.
  Devolución directa de mensajes internos:
  `apps/api/src/modules/portal/auth-routes.ts:231`
  (`return { success: false, error: 'Error interno: ${msg}' }`),
  `apps/api/src/modules/portal/credentials-routes.ts:41`,
  `apps/api/src/modules/calendar/routes.ts:94,129`,
  `apps/api/src/modules/employee-files/routes.ts:314,363`,
  y muchos `err instanceof Error ? err.message : ...` retornados en respuestas.
- **Impacto:** Sin un onError, las excepciones no capturadas usan la respuesta por
  defecto de Elysia; combinado con los `err.message` retornados, se pueden
  exponer detalles internos (nombres de columnas, fragmentos SQL, rutas).
- **Remediación:** Añadir `.onError` que normalice/sanee respuestas (genérico al
  cliente, detalle solo en logs) y dejar de retornar `err.message` crudo.

#### M-2. Datos sensibles en logs de error

- **Archivo:línea:** `apps/api/src/modules/portal/auth-routes.ts:229`
  (`console.error('[portal/login] error:', msg, err)` — vuelca el objeto `err`
  completo durante el login), `:78`;
  `apps/api/src/modules/auth/routes.ts:199` (errores de transporte de correo);
  `apps/api/src/modules/superadmin/routes.ts:179,184`.
- **Impacto:** Posible filtración de credenciales SMTP, fragmentos de consulta o
  PII a stdout/agregadores de logs.
- **Remediación:** Loggear solo tipo/código de error; nunca el objeto completo en
  rutas de autenticación.

#### M-3. Esquemas de validación demasiado permisivos

- **Archivo:línea:**
  - `apps/api/src/modules/facial/routes.ts:451` —
    `body: t.Record(t.String(), t.Unknown())` (heartbeat de terminal sin validar).
  - `apps/api/src/modules/employees/routes.ts:36,104` —
    `customFields: t.Optional(t.Record(t.String(), t.Unknown()))`.
  - `apps/api/src/modules/custom-fields/routes.ts:57,58,82,93` —
    `t.Any()` / `t.Array(t.Any())` / `t.Nullable(t.Any())`.
- **Impacto:** Estructuras arbitrarias aceptadas; superficie para abuso/inyección
  en capas posteriores y crecimiento no acotado de payloads.
- **Remediación:** Acotar con esquemas explícitos (campos y tipos conocidos).

#### M-4. Credenciales SMTP sin cifrado en reposo

- **Archivo:línea:** `apps/api/src/lib/mailer.ts:38-45` (lee
  `company.mailUsername` / `company.mailPassword` desde `company_config`).
- **Impacto:** Un compromiso de BD expone las credenciales SMTP de cada tenant en
  texto plano.
- **Remediación:** Cifrar credenciales SMTP en reposo (KMS/secret box) y
  descifrar solo en el envío.

#### M-5. Política de contraseña débil en el portal y tokens de larga vida sin revocación

- **Archivo:línea:** `apps/api/src/modules/portal/auth-routes.ts:307,449`
  (`password: t.String({ minLength: 6 })`, vs `minLength: 8` en admin —
  `auth/routes.ts:70,103`). Cookie/JWT admin de 7 días
  (`apps/api/src/middleware/auth.ts:46`, `auth/service.ts:76`); portal 8h
  (`auth-routes.ts:204,213`).
- **Detalle:** Los JWT son stateless: `logout` solo borra la cookie
  (`auth/routes.ts:109-112`); un Bearer robado sigue siendo válido hasta `exp`.
  No hay lista de revocación ni rotación por cambio de permisos (depende de un
  `/auth/refresh` manual, `auth/routes.ts:146`).
- **Remediación:** Unificar política mínima de 8+; reducir TTL; considerar
  invalidación server-side (jti/denylist) o refresh tokens cortos.

#### M-6. Reconocimiento facial: umbral permisivo y liveness no forzado

- **Archivo:línea:** `apps/api/src/modules/facial/service.ts:135-147`
  (umbral `DEFAULT_MATCH_THRESHOLD`), `apps/api/src/modules/facial/kiosk-service.ts`
  (verificación 1:1, `livenessScore` opcional y no validado, `:136-167`).
- **Impacto:** Falsos positivos en verificación facial / ausencia de
  anti-spoofing; un rostro similar podría marcar asistencia. (Severidad depende
  del modelo subyacente; tratar como defensa en profundidad de M-4/A-4.)
- **Remediación:** Endurecer umbral para 1:1, exigir `livenessScore` mínimo, y
  anti-presentación.

---

### 🔵 BAJO

#### B-1. Rate limiting global deshabilitado; endpoints de máquina sin límite

- **Archivo:línea:** `apps/api/src/index.ts:63-68` (el `globalRateLimit` está
  intencionalmente desmontado). Solo los logins admin usan `loginRateLimit`.
  Sin límite: import biométrico (`attendance/import-routes.ts`), kiosk facial,
  punches y login de portal.
- **Impacto:** Superficie de fuerza bruta/DoS en endpoints sin protección.
- **Remediación:** Rate-limit por ruta en endpoints de autenticación,
  importación y kiosko (existe la primitiva en `middleware/rateLimit.ts`).

#### B-2. Patrón `sql.raw` frágil en el timeline unificado (no inyectable)

- **Archivo:línea:** `apps/api/src/modules/attendance/unified-service.ts:126-152`.
- **Detalle:** Se construye `whereClause` por concatenación, pero **solo** con
  strings fijos de placeholders (`fp.employee_id = $1::uuid`, etc.); los valores
  de usuario van a un arreglo `params` (`:98-123`). `LIMIT ${limit}` interpola un
  número ya saneado/acotado por el caller
  (`unified-routes.ts:59`, `Math.min(500, Math.max(1, Number(query.limit)))`).
  **No hay inyección** (ningún string de usuario llega al SQL). Sí existe un bug
  latente: `params` se arma pero nunca se enlaza a `db.execute(sql.raw(...))`.
- **Remediación:** Migrar a consulta parametrizada de Drizzle; pasar `limit` como
  parámetro; eliminar el `params` muerto.

#### B-3. Descarga de adjuntos sin `Content-Disposition`; MIME declarado por cliente

- **Archivo:línea:** `apps/api/src/modules/employee-files/routes.ts:412,440`
  (`set.headers['Content-Type'] = att.mimeType`, sin `Content-Disposition`);
  el `mimeType` proviene del header del cliente (`routes.ts:86,93`).
- **Detalle:** La lista blanca de MIME y el límite de tamaño SÍ se aplican en
  servicio (`employee-files/service.ts:147-151`), pero el tipo es el declarado
  por el cliente (no se "sniffea"). Servir sin `Content-Disposition: attachment`
  permite render inline.
- **Remediación:** Forzar `Content-Disposition: attachment`; validar el tipo real
  del contenido.

#### B-4. Ausencia de headers de seguridad

- **Detalle:** La API no emite `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `HSTS` ni `CSP` (`apps/api/src/index.ts`).
- **Remediación:** Añadir headers de seguridad por defecto (plugin onAfterHandle).

#### B-5. Colisión potencial de `idempotencyKey` por defecto

- **Archivo:línea:** `apps/api/src/modules/attendance/punch-service.ts:24-25`;
  `attendance/import-routes.ts` (clave `device:emp:fecha_hora`).
- **Impacto:** Marcajes legítimos del mismo segundo podrían deduplicarse.
- **Remediación:** Añadir nonce aleatorio o granularidad de subsegundo.

---

## 3. Verificaciones que pasaron correctamente

- **Aislamiento schema-per-tenant** bien implementado: `search_path`
  `tenant_<slug>,payroll_auth,public` (`packages/db/src/client.ts:25-31`);
  cliente cacheado por tenant.
- **Hashing de contraseñas** con bcrypt vía `Bun.password` y verificación de
  tiempo constante (`apps/api/src/lib/password.ts:10-21`).
- **Reseteo de contraseña del panel admin** correcto: token hasheado SHA-256, un
  solo uso, expiración 30 min, invalidación de pendientes
  (`apps/api/src/modules/auth/password-reset-service.ts:36-151`).
- **`forgot-password` admin** responde 200 siempre (sin enumeración de usuarios)
  (`apps/api/src/modules/auth/routes.ts:190-209`).
- **Impersonación de super-admin** con token corto (30 min) y auditoría en
  `super_admin_audit` (`apps/api/src/modules/superadmin/routes.ts:93-133`).
- **Rutas super-admin** protegidas por `guardSuperAdmin`, con `type` del JWT como
  fuente de verdad (`apps/api/src/middleware/auth.ts:98-113`,
  `superadmin/routes.ts`).
- **CSRF** por validación de `Origin` contra allowlist + cookies `SameSite=Lax`
  (`apps/api/src/middleware/csrf.ts`, `config/origins.ts`).
- **CORS** restringido a orígenes de confianza; el comodín de localhost solo
  aplica fuera de producción (`apps/api/src/config/origins.ts:39-45`).
- **Cookies de sesión** `httpOnly` y `secure` en producción
  (`apps/api/src/modules/auth/service.ts:71-79`).
- **Consultas Drizzle parametrizadas** en todo el ORM; no se halló interpolación
  de entrada de usuario en SQL (el único `sql.raw` revisado no es inyectable —
  ver B-2).
- **`guardTenantMatchesToken`** correctamente aplicado en `treasury`,
  `vacations`, `time-balance`, `audit`, `reports`, `employees/dependents-routes`,
  `portal/credentials-routes`, `portal/facial-routes`,
  `attendance/{punch,unified,sync,devices,import,consolidation,justification}-routes`.
- **Portal data-routes** acota cada consulta al `employeeId` del token y deriva el
  tenant desde `payload.tenantSlug` del propio token (no del header), por lo que
  no hay fuga cross-employee ni cross-tenant
  (`apps/api/src/modules/portal/data-routes.ts:43-61`).
- **IDOR intra-tenant:** no detectado. Las consultas usan el `db` por-tenant y las
  rutas multi-clave validan ambos identificadores (p.ej.
  `dependents-routes.ts` usa `and(eq(id), eq(employeeId))`).
- **Token de dispositivo biométrico:** 32 bytes aleatorios, almacenado solo como
  hash SHA-256, mostrado en claro una sola vez
  (`apps/api/src/modules/attendance/devices-service.ts:58-60`).
- **Uso de `publicDb`:** revisado en `superadmin`, `auth`, `portal` (descubrimiento
  de tenant), workers; todos los usos son apropiados (datos públicos o protegidos
  por `guardSuperAdmin`).
- **Path traversal en adjuntos:** mitigado con saneo de nombre + `normalize` +
  verificación `startsWith('..')` (`apps/api/src/modules/employee-files/storage.ts:21-88`).
- **Validación de env:** `JWT_SECRET` exige ≥32 chars y `DATABASE_URL` URL válida
  (`apps/api/src/config/env.ts:7-8`).

### Falsos positivos descartados (de herramientas automáticas)

- **"Inyección SQL crítica" en `unified-service.ts`:** descartada. Ningún string de
  usuario se concatena al SQL; las condiciones son placeholders `$N` fijos y el
  `LIMIT` es numérico acotado (ver B-2).
- **"Fuerza bruta de token de dispositivo en minutos":** descartada. El token es
  de 256 bits aleatorios con hash SHA-256 en BD; la fuerza bruta es inviable
  (el problema real es la falta de validación de frescura/vínculo — ver A-4).
