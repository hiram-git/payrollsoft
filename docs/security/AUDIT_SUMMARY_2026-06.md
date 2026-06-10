# Auditoría de Seguridad — Resumen Consolidado del Monorepo

- **Alcance:** consolidación de las cuatro auditorías por app
  (`AUDIT_API`, `AUDIT_WEB`, `AUDIT_MOBILE`, `AUDIT_DESKTOP`) **más** una
  auditoría nueva de lo no cubierto: `packages/*`, Turborepo, archivos `.env` de
  ejemplo, `docker-compose`, scripts raíz, CI/CD y el lockfile.
- **Fecha:** 2026-06-10
- **Tipo:** revisión estática (read-only). No se modificó código.

> Reportes fuente: `docs/security/AUDIT_{API,WEB,MOBILE,DESKTOP}_2026-06.md`.
> Este documento NO repite cada hallazgo: consolida Críticos/Altos, identifica
> patrones transversales, añade los hallazgos nuevos del monorepo y propone el
> plan de remediación.

---

## 1. Resumen ejecutivo

Las apps cliente delegan correctamente la autorización en la API, pero la
**frontera multi-tenant de la API es el riesgo dominante**: muchas rutas
sensibles no aplican `guardTenantMatchesToken`, permitiendo acceso cross-tenant
con un header `X-Tenant` manipulado (API C-1). La auditoría del monorepo añade
dos hallazgos nuevos de alto impacto que las sesiones por-app no podían ver:
**credenciales de super-admin hardcodeadas y ejecutables en producción**
(`packages/db/src/seed.ts`) y la **falta de validación del slug de tenant en el
camino por-request**, que habilita un DoS pre-autenticación por agotamiento de
pools de conexión. Sobre eso se repiten patrones transversales: contraseñas por
defecto conocidas, transporte en claro / ausencia de headers de seguridad,
credenciales SMTP sin cifrar, y confianza en datos de cliente para integridad de
marcaje. No hay CI/CD, por lo que ninguno de estos se detecta de forma
automática. El desktop (Tauri) es la pieza más sólida y solo hereda riesgo de la
web.

---

## 2. Consolidado de hallazgos Críticos y Altos

| ID | Sev | App / Área | Hallazgo | Cita principal |
|----|-----|------------|----------|----------------|
| **API C-1** | 🔴 Crítico | api | Acceso cross-tenant: rutas sensibles sin `guardTenantMatchesToken`; `db` se resuelve del header `X-Tenant` | `apps/api/src/middleware/tenant.ts:13-24`; `payroll/routes.ts`, `employees/routes.ts`, `attendance/routes.ts`, `catalogs/*`, etc. |
| **MONO N-1** | 🔴 Crítico | packages/db | Credenciales super-admin **hardcodeadas** (`superadmin@payroll.dev` / `SuperAdmin123!`) creadas por un seed con script `seed:prod` y **sin guard de entorno** | `packages/db/src/seed.ts:58-59,90`; script `packages/db/package.json` `seed:prod` |
| **MONO N-2** | 🟠 Alto | api + packages/db | `X-Tenant` no se valida en el request-path → caché de pools de conexión **sin límite** (DoS pre-auth) y slug sin validar hacia `search_path` | `apps/api/src/middleware/tenant.ts:14-23`, `packages/db/src/client.ts:7,25-31`; existe `validateTenantSlug` pero no se llama (`packages/utils/src/tenant-slug.ts:51`) |
| **API A-1** | 🟠 Alto | api | Token de reseteo del portal en **texto plano** + escaneo multi-tenant + sin rate-limit | `apps/api/src/modules/portal/auth-routes.ts:349-356,416,439` |
| **API A-2** | 🟠 Alto | api | Contraseña por defecto embebida `172839` (auto-creación de credenciales) | `apps/api/src/modules/portal/auth-routes.ts:30,114`; `credentials-routes.ts:135,250` |
| **API A-3** | 🟠 Alto | api | Login del portal sin rate-limit + enumeración cross-tenant | `apps/api/src/modules/portal/auth-routes.ts:87-240,42-81` |
| **API A-4** | 🟠 Alto | api | Marcajes falsos/retrofechados: `punchedAt`/`source` del cliente sin validar | `apps/api/src/modules/attendance/punch-service.ts:20`, `punch-routes.ts:43-66,90` |
| **WEB A-1** | 🟠 Alto | web | XSS almacenado: `set:html={JSON.stringify(...)}` sin escapar `<` (5 vistas) | `apps/web/src/pages/employee-files/index.astro:356` (+4) |
| **WEB A-2** | 🟠 Alto | web | Dependencia `xlsx@0.18.5` (prototype pollution CVE-2023-30533 + ReDoS) sobre archivos subidos | `apps/web/package.json:26`; `api/employees/import.ts:199` |
| **MOB A-1** | 🟠 Alto | mobile | JWT de sesión en **almacenamiento sin cifrar** (Preferences); en kiosko es token tenant `facial:mark` | `apps/mobile/src/lib/storage.ts:11,44-45` |
| **MOB A-2** | 🟠 Alto | mobile | Transporte en claro permitido; sin HTTPS forzado ni pinning | `apps/mobile/capacitor.config.ts:19-22`, `src/config/env.ts:10` |
| **MOB A-3** | 🟠 Alto | mobile | Integridad biométrica: descriptor/liveness/`capturedAt` generados en cliente (replay/retrofecha) | `apps/mobile/src/lib/face-api.ts:80-112`, `Punch.tsx:114-123,303-314` |
| **MONO N-3** | 🟠 Alto | env | `.env.example` `JWT_SECRET` placeholder pasa la validación `min(32)`; copiado verbatim → clave de firma conocida | `.env.example:10`; validación solo por longitud en `apps/api/src/config/env.ts:8` |

> Nota de severidad: **N-1** se clasifica como Crítico porque el super-admin puede
> impersonar cualquier tenant (ver API "Verificaciones": impersonación), la
> credencial está en el repo y existe un `seed:prod` sin guard. Su explotabilidad
> real depende de si el seed se ejecutó contra producción y/o de si la cuenta por
> defecto se rotó — debe verificarse operativamente como primer paso.

---

## 3. Hallazgos transversales (se repiten entre apps)

### T-1. Contraseñas/credenciales por defecto conocidas — **transversal a las 4 capas**
- `172839` como contraseña por defecto del portal: API
  (`portal/auth-routes.ts:30`), Web (`api/employees/[id]/portal.ts:43`, y visible
  en UI `employees/[id].astro:1524`).
- Defaults de seed: `SuperAdmin123!` (`seed.ts:59`), `Admin123!` / `ChangeMe123!`
  (`seed.ts:51-52`).
- Placeholder de `JWT_SECRET` que pasa validación (`.env.example:10`).
- **Remediación común:** generar secretos aleatorios; forzar cambio en primer uso;
  rechazar valores por defecto/placeholder en arranque.

### T-2. Transporte en claro y ausencia de headers de seguridad — **4 capas**
- API: sin CSP/HSTS/`X-Frame-Options`/`nosniff` (API B-4).
- Web: `checkOrigin: false` + sin headers de seguridad (WEB M-1, M-3).
- Mobile: `cleartext: true` + `http://` por defecto, sin pinning (MOB A-2).
- Desktop: `csp: null` + no fuerza HTTPS de la URL destino (DESKTOP M-1, M-2).
- **Remediación común:** forzar HTTPS en producción en todos los clientes; añadir
  CSP + headers de seguridad en web/api/desktop; pinning en móvil.

### T-3. Credenciales SMTP sin cifrar en reposo — **api + web** (misma columna)
- `company_config.mail_password` se lee en claro en API (`lib/mailer.ts:38-45`) y
  Web (`lib/mailer.ts`). **Remediar una vez en la capa compartida.**

### T-4. Integridad de marcaje basada en datos del cliente — **api + mobile**
- El cliente envía `punchedAt`/`capturedAt`/`livenessScore`/`source` y el servidor
  no valida frescura ni liveness (API A-4 + MOB A-3). **Misma frontera de
  confianza; remediar en el servidor.**

### T-5. Ciclo de vida del token JWT — **api + mobile**
- JWT stateless sin revocación ni rotación, TTL largo (API M-5); almacenado sin
  cifrar en el dispositivo (MOB A-1). **Tratar token lifecycle de forma unificada.**

### T-6. XSS de la web se propaga al shell de escritorio — **web → desktop**
- El XSS de `set:html` (WEB A-1) se ejecutaría dentro de la ventana Tauri por
  `csp: null` (DESKTOP M-1). **Arreglar la web reduce el riesgo del desktop.**

---

## 4. Auditoría nueva: `packages/`, Turborepo, `.env`, Docker, CI, lockfile

### 🔴 Crítico

**N-1. Credenciales de super-admin/tenant-admin hardcodeadas y ejecutables en prod**
- **Archivo:línea:** `packages/db/src/seed.ts:58-59`
  (`SUPER_ADMIN_EMAIL = 'superadmin@payroll.dev'`,
  `SUPER_ADMIN_PASSWORD = 'SuperAdmin123!'`), creadas en `:90`;
  defaults de admin de tenant en `:51-52` (`Admin123!` / `ChangeMe123!`).
- **Detalle:** `packages/db/package.json` expone `seed:prod` (`bun src/seed.ts`)
  sin ningún guard de `NODE_ENV`. Si se ejecuta contra una BD de producción/staging
  (o si la cuenta por defecto nunca se rota), existe un super-admin con credenciales
  públicas en el repositorio. El super-admin puede impersonar cualquier tenant
  (flujo `/superadmin/tenants/:slug/impersonate`).
- **Impacto:** Compromiso total de la plataforma.
- **Remediación:** Exigir credenciales por env/aleatorias; bloquear el seed de
  super-admin fuera de desarrollo; rotar de inmediato cualquier `superadmin@payroll.dev`
  existente y auditar si la cuenta fue creada en prod.

### 🟠 Alto

**N-2. `X-Tenant` sin validar en el request-path → DoS por pools de conexión + slug a `search_path`**
- **Archivo:línea:** `apps/api/src/middleware/tenant.ts:14-23` toma el header crudo
  y llama `getTenantDb(tenantSlug)` (`apps/api/src/config/db.ts:6`) →
  `packages/db/src/client.ts:25-31`, que interpola `tenant_${tenantSlug}` en el
  `search_path` y **cachea un cliente postgres por slug en un `Map` sin límite**
  (`client.ts:7,30`). El `derive` corre en **cada** request, antes de cualquier
  guard.
- **Detalle:** `validateTenantSlug` (regex estricta + reservados) existe en
  `packages/utils/src/tenant-slug.ts:51` y se usa al **provisionar**, pero **no** en
  el camino por-request. Un atacante no autenticado puede enviar muchos valores
  distintos de `X-Tenant` a `POST /auth/login` (que consulta la BD): cada slug
  nuevo crea y cachea un pool de conexiones → agotamiento de memoria/conexiones
  (DoS). Además, el valor sin validar llega al `search_path` (defensa en profundidad
  ausente; postgres-js lo envía como parámetro de protocolo, por lo que no es SQLi
  clásica, pero es una superficie que debe cerrarse).
- **Impacto:** DoS pre-autenticación; endurecimiento del límite multi-tenant.
- **Remediación:** Validar el slug con `validateTenantSlug` en el `tenantPlugin`
  (rechazar 400 si no pasa) **antes** de `getTenantDb`; acotar el `Map` (LRU/límite)
  o resolver solo contra tenants conocidos.

### 🟡 Medio

**N-3. Placeholder de `JWT_SECRET` que pasa la validación** (ver tabla, fila MONO N-3)
- `.env.example:10` trae un placeholder de 56 chars que satisface `min(32)`
  (`apps/api/src/config/env.ts:8`). Copiado sin cambiar → clave de firma JWT
  conocida → falsificación de cualquier token. **Remediación:** rechazar en arranque
  el valor placeholder y exigir entropía mínima (no solo longitud).

### 🔵 Bajo

**N-4. Sin CI/CD: no hay SCA, secret-scanning ni SAST automatizados**
- No existe `.github/workflows` ni equivalente. Hallazgos como `xlsx` (WEB A-2) o
  secretos commiteados (N-1) no se detectan automáticamente.
- **Remediación:** Añadir pipeline con `bun audit`/SCA, escaneo de secretos
  (gitleaks) y lint/test obligatorios en PR.

**N-5. `docker-compose.dev.yml` expone servicios con credenciales triviales**
- **Archivo:línea:** `docker-compose.dev.yml` mapea `postgres` (5432, creds
  `postgres/postgres` de `.env.pgsql.example`) y `redis` (6379, **sin auth**) a
  puertos del host. Solo desarrollo, pero un puerto abierto en una laptop en LAN es
  exponible. **Remediación:** ligar a `127.0.0.1`, documentar que es solo-dev,
  poner contraseña a redis si se usa.

**N-6. Turbo no declara `env` de entrada en la tarea `build`**
- **Archivo:línea:** `turbo.json:4-7`. Builds que hornean valores de entorno
  (`PUBLIC_API_URL` en web, `VITE_*` en móvil, `PAYROLL_DESKTOP_URL` en desktop) no
  listan esas vars como inputs del hash, así que la caché podría servir un binario
  con un endpoint horneado **obsoleto**. Riesgo de integridad/operativo.
- **Remediación:** Declarar `env`/`inputs` por tarea para invalidar la caché al
  cambiar la configuración horneada.

### Verificaciones del monorepo que pasaron
- **Sin secretos reales commiteados:** las claves R2/S3 en `.env.example:55-58`
  están vacías; el bloque PEM en `scripts/local-https.ps1:121-127` es una
  **plantilla** de generación de certificados de dev, no una clave commiteada.
- **`validateTenantSlug` es estricta** (regex + lista de reservados) y se aplica en
  provisioning y como CHECK en `payroll_auth.tenants`
  (`packages/utils/src/tenant-slug.ts:14,75`). El gap es solo el request-path (N-2).
- **Lockfile commiteado** (`bun.lock`) → instalaciones reproducibles.
- **`.env.pgsql.example`** solo trae credenciales de desarrollo triviales, sin
  secretos de producción.
- **`@payroll/types`** es el paquete correcto para tipos compartidos (el móvil debe
  migrar ahí, ver MOB B-4).

---

## 5. Plan de remediación priorizado

Convención: **una rama por hallazgo crítico**; los menores **agrupados por app**.
Prefijo sugerido `security/`.

### Fase 0 — Frontera de autenticación/identidad (inmediato, ~horas–1 día)
| Orden | Rama | Cubre | Acción núcleo |
|---|---|---|---|
| 1 | `security/seed-credentials` | **N-1** (Crítico) | Rotar/eliminar super-admin por defecto; exigir creds por env; bloquear seed de super-admin fuera de dev; **verificar si se sembró en prod** |
| 2 | `security/api-tenant-guard` | **API C-1** (Crítico) | Imponer `guardTenantMatchesToken` por defecto (fail-closed en el `tenantPlugin`); super-admin explícito |
| 3 | `security/tenant-slug-validation` | **N-2** (Alto) | `validateTenantSlug` en el request-path (400 si falla); acotar el `Map` de conexiones |
| 4 | `security/env-jwt-secret` | **N-3** (Medio) | Rechazar placeholder/baja entropía de `JWT_SECRET` en `config/env.ts` |

### Fase 1 — Cuentas, portal y XSS (días)
| Orden | Rama | Cubre |
|---|---|---|
| 5 | `security/api-portal-auth` | **API A-1, A-2, A-3** + **T-1**: hashear token de reseteo, rate-limit login/forgot/reset, reemplazar `172839` por aleatorio + cambio forzado |
| 6 | `security/web-xss-sethtml` | **WEB A-1**: helper `safeJsonForScript()` aplicado a las 5 vistas |
| 7 | `security/web-deps-xlsx` | **WEB A-2**: reemplazar `xlsx` por librería mantenida; validar contenido subido |

### Fase 2 — Integridad de marcaje y clientes (días–semana)
| Orden | Rama | Cubre |
|---|---|---|
| 8 | `security/attendance-integrity` | **API A-4 + MOB A-3 (T-4)**: validar frescura de `punchedAt`/`capturedAt` y liveness en servidor; forzar `source`; vincular dispositivo↔empleado |
| 9 | `security/mobile-secure-storage` | **MOB A-1 + M-3**: Keychain/Keystore; cifrar/limpiar cola offline |
| 10 | `security/transport-https` | **MOB A-2 + DESKTOP M-2 (T-2)**: forzar HTTPS/pinning en móvil; exigir https en la URL del desktop |

### Fase 3 — Endurecimiento agrupado por app + repo (continuo)
| Orden | Rama | Cubre |
|---|---|---|
| 11 | `security/api-hardening` | API M-1..M-6, B-1..B-5 (onError, saneo de logs, esquemas, política de contraseñas/TTL, umbral facial, rate-limits, headers) |
| 12 | `security/web-hardening` | WEB M-1 (`checkOrigin`), M-3 (headers/CSP — **T-6**), M-4 (checks de permiso), B-1..B-3 |
| 13 | `security/mobile-hardening` | MOB M-1 (lockdown kiosko), M-2 (historial), B-1..B-4 |
| 14 | `security/desktop-hardening` | DESKTOP M-1 (CSP), B-1..B-5 |
| 15 | `security/shared-smtp-encryption` | **T-3**: cifrar `mail_password` en reposo (capa compartida api+web) |
| 16 | `security/repo-hygiene-ci` | **N-4, N-5, N-6**: pipeline con SCA + gitleaks + lint/test; ligar puertos docker a localhost; `env` inputs en Turbo |

### Notas de ejecución
- **Fase 0 primero y completa**: son la cadena de auth/identidad (super-admin,
  cross-tenant, slug, firma JWT). Hasta cerrarlas, el resto es secundario.
- **Remediar transversales una sola vez** en la capa compartida: T-1 (defaults),
  T-3 (SMTP), T-4 (integridad), para no divergir entre apps.
- **Verificación operativa urgente (no es código):** confirmar si `seed:prod` se
  ejecutó alguna vez contra una BD real y rotar `superadmin@payroll.dev`; revisar
  qué `JWT_SECRET` y qué `DESKTOP_URL`/`VITE_API_URL` (http vs https) hay en los
  despliegues actuales.
