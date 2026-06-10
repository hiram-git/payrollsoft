# Auditoría de Seguridad — `apps/web`

- **Alcance:** únicamente `apps/web` (Astro SSR en modo `output: 'server'` +
  proxy BFF hacia la API Elysia).
- **Fecha:** 2026-06-10
- **Tipo:** revisión estática (read-only). No se modificó código.
- **Arquitectura:** Astro SSR (adapter Node standalone). El web actúa como
  Backend-For-Frontend: cada página/endpoint reenvía la cookie `auth` y un
  header `X-Tenant` a la API, que re-verifica la firma del JWT en cada llamada.

> La remediación se hará en sesiones separadas. Este documento solo describe y
> clasifica. Cada hallazgo cita `archivo:línea`.

---

## 1. Resumen ejecutivo

La postura del web es razonable: la identidad se obtiene de un JWT en cookie
`httpOnly`, los datos sensibles se piden a la API reenviando esa cookie (la API
re-verifica firma y tenant), las cookies de admin (`auth`) y portal
(`portal_auth`) están separadas, y las plantillas de correo/PDF escapan
correctamente. Los hallazgos relevantes son: (1) **XSS almacenado** por uso
inconsistente de `set:html={JSON.stringify(...)}` sin escapar `<` en cinco
vistas (mientras vistas hermanas sí lo escapan), inyectable vía nombres de
empleado / valores de campos personalizados; (2) dependencia **`xlsx@0.18.5`**
vulnerable (prototype pollution + ReDoS) usada para parsear archivos subidos por
el usuario; (3) **CSRF** con defensa en profundidad debilitada
(`checkOrigin: false`), mitigado parcialmente por `SameSite=Lax`; (4) contraseña
por defecto predecible `172839` embebida; y (5) ausencia de headers de
seguridad. Se descartaron varias afirmaciones automáticas (atributos `data-*`
"inseguros", "todos los `set:html` seguros") como falsos positivos/negativos
tras verificación directa.

---

## 2. Hallazgos por severidad

### 🟠 ALTO

#### A-1. XSS almacenado: `set:html={JSON.stringify(...)}` sin escapar (uso inconsistente)

- **Archivo:línea (SIN escape — vulnerables):**
  - `apps/web/src/pages/employee-files/index.astro:356`
    — `set:html={JSON.stringify(employees)}` (incluye nombres de empleado).
  - `apps/web/src/pages/employee-files/[id]/edit.astro:202-207`
    — serializa `extraFields` (valores de campos personalizados) y `fileLabels`.
  - `apps/web/src/pages/employees/[id].astro:1640`
    — `set:html={JSON.stringify(customFieldDefs)}` (etiquetas de campos).
  - `apps/web/src/pages/config/custom-fields/[id].astro:115`
    — `set:html={JSON.stringify(allFields)}`.
  - `apps/web/src/pages/config/employee-files/index.astro:404`
    — `set:html={JSON.stringify(subtypes)}`.
- **Detalle:** `set:html` inyecta contenido **crudo** (no auto-escapa). El
  contenido va dentro de `<script type="application/json">`, que el navegador no
  ejecuta, pero `JSON.stringify` **no** escapa `<` ni `/`: si cualquier string
  serializado contiene la subcadena `</script>`, cierra la etiqueta y permite
  inyectar markup/JS a continuación (XSS basado en DOM). Los datos incluyen texto
  controlable por el usuario (nombres de empleado, valores/etiquetas de campos
  personalizados, nombres de subtipos).
- **Evidencia de inconsistencia (el equipo conoce la mitigación):** vistas
  hermanas SÍ escapan con `.replace(/</g, '\\u003c')`:
  `apps/web/src/pages/loans/new.astro:335`,
  `apps/web/src/pages/payroll/[id]/[lineId].astro:575`,
  `apps/web/src/pages/acumulados/index.astro:482`.
- **Impacto:** XSS almacenado autenticado. Un usuario con permiso para fijar un
  nombre de empleado o un valor de campo personalizado a, p.ej.,
  `</script><img src=x onerror=...>` ejecuta JS cuando otro usuario (HR/admin)
  abre la vista. La cookie `auth` es `httpOnly` (no se roba el JWT vía
  `document.cookie`), pero el script puede actuar como la víctima (lanzar
  mutaciones con su sesión, exfiltrar datos de la página). Severidad alta por el
  vector de "nombre de empleado" (texto libre, ampliamente escribible, incluso
  vía importación masiva).
- **Remediación:** Aplicar el mismo `.replace(/</g, '\\u003c')` (idealmente un
  helper compartido tipo `safeJsonForScript()`) en TODAS las inyecciones JSON en
  `<script>`.

#### A-2. Dependencia vulnerable: `xlsx@0.18.5` parseando archivos subidos por el usuario

- **Archivo:línea:** `apps/web/package.json:26` (`"xlsx": "^0.18.5"`).
- **Uso sobre input no confiable:**
  - `apps/web/src/pages/api/employees/import.ts:199`
    — `XLSX.read(buf, { type: 'array', cellDates: true })` sobre un archivo
    cargado por el usuario.
  - `apps/web/src/pages/api/catalog-import/[type]/import.ts:96`
    — `XLSX.read(buffer, { cellDates: true })`.
- **Vulnerabilidades conocidas de SheetJS 0.18.5 (rama npm):**
  - **CVE-2023-30533** — Prototype Pollution (alto).
  - **ReDoS** (GHSA — denegación de servicio por expresiones regulares) en el
    parseo. La versión corregida no está publicada en el registro npm (el
    mantenedor solo distribuye por su CDN), por lo que `^0.18.5` queda anclada a
    una versión vulnerable.
- **Impacto:** Un atacante autenticado que sube un `.xlsx` malicioso puede
  contaminar prototipos o degradar el servicio (el límite de tamaño en
  `employees/import.ts` no valida el contenido).
- **Remediación:** Migrar a `exceljs` u otra librería mantenida, o consumir la
  build parcheada de SheetJS desde su CDN oficial; validar/sanear el contenido
  del libro tras el parseo.

---

### 🟡 MEDIO

#### M-1. CSRF: defensa de Origin desactivada (`checkOrigin: false`)

- **Archivo:línea:** `apps/web/astro.config.mjs:10-12`
  (`security: { checkOrigin: false }`). Los endpoints proxy en
  `apps/web/src/pages/api/**/*.ts` procesan `formData` y reenvían a la API sin
  validar `Origin`/`Referer` (p.ej. `apps/web/src/pages/api/employees/index.ts`,
  `.../config/conceptos/index.ts`, `.../config/company`).
- **Detalle:** `checkOrigin: false` deshabilita la verificación de Origin que
  Astro hace por defecto en submits de formulario. Además, la protección CSRF de
  la API (que valida `Origin`) **no aplica** a estas mutaciones: el `fetch`
  servidor→API se hace desde el proceso web y no transporta el `Origin` del
  navegador, por lo que la API lo trata como cliente no-navegador y lo permite.
- **Mitigación existente (por eso es MEDIO y no ALTO):** la cookie `auth` se
  emite con `SameSite=Lax` (la setea la API y el web la reenvía verbatim —
  `apps/web/src/pages/api/auth/login.ts:38-42`). `SameSite=Lax` impide el envío
  de la cookie en POST cross-site, neutralizando el CSRF clásico por formulario.
- **Riesgo residual:** se pierde la defensa en profundidad; cualquier mutación
  por método "seguro" (GET) o vector same-site (subdominio comprometido, ver
  A-1) no queda cubierta solo por `SameSite=Lax`.
- **Remediación:** Reactivar `checkOrigin: true` y/o validar `Origin`/`Referer`
  en los handlers de mutación; considerar tokens CSRF para acciones sensibles.

#### M-2. Contraseña por defecto predecible embebida (`172839`)

- **Archivo:línea:** `apps/web/src/pages/api/employees/[id]/portal.ts:43`
  (`body: JSON.stringify({ employeeId: params.id, password: '172839' })`);
  mostrada en UI en `apps/web/src/pages/employees/[id].astro:1524` y
  `apps/web/src/pages/config/portal-credentials/index.astro:283`.
- **Detalle:** El reset de credenciales del portal fija la contraseña a un valor
  fijo y conocido. Aunque la acción requiere autorización del administrador, la
  contraseña resultante es predecible para cualquiera que conozca la cédula del
  colaborador hasta que éste la cambie. (Corresponde al mismo hallazgo del lado
  API; aquí se documenta su superficie en el web.)
- **Remediación:** Generar contraseña aleatoria por colaborador y forzar cambio
  en el primer acceso; no mostrar el valor por defecto en la UI.

#### M-3. Ausencia de headers de seguridad HTTP

- **Archivo:línea:** `apps/web/astro.config.mjs` y `apps/web/src/middleware.ts`
  no establecen `Content-Security-Policy`, `X-Frame-Options`,
  `X-Content-Type-Options`, `Strict-Transport-Security` ni `Referrer-Policy`.
- **Impacto:** Sin `X-Frame-Options`/CSP `frame-ancestors` hay riesgo de
  clickjacking; sin CSP no hay mitigación de defensa en profundidad para el XSS
  de A-1; sin `nosniff` hay riesgo de MIME-sniffing.
- **Remediación:** Emitir headers de seguridad desde el middleware o el adapter
  (CSP estricta, `X-Frame-Options: DENY`, `nosniff`, HSTS en producción).

#### M-4. Páginas SSR sensibles sin verificación de permiso server-side

- **Archivo:línea (solo verifican presencia de cookie, no permiso):**
  `apps/web/src/pages/employees/index.astro:6-8`,
  `apps/web/src/pages/employees/[id].astro:7-8`,
  `apps/web/src/pages/payroll/index.astro:6-8`,
  `apps/web/src/pages/config/acreedores/index.astro:6`,
  `apps/web/src/pages/config/departments/index.astro:6` (y catálogos similares).
- **Detalle:** Estas páginas hacen `if (!authCookie) return redirect('/login')`
  pero no comprueban el permiso (`can(...)`) como sí hacen otras
  (`apps/web/src/pages/treasury/index.astro:14-16`,
  `apps/web/src/pages/audit/index.astro:7-9`). El acceso real a datos sí está
  protegido porque la API responde 401/403 y la página corta tras el fetch, pero
  un usuario autenticado sin el permiso puede recibir el "cascarón" SSR.
- **Impacto:** Exposición de estructura/UI (no de datos, que dependen del fetch
  a la API). Severidad media-baja.
- **Remediación:** Añadir `can(identity, '<permiso>')` en el frontmatter de
  forma consistente.

---

### 🔵 BAJO

#### B-1. Decisiones de UI basadas en JWT sin verificación de firma

- **Archivo:línea:** `apps/web/src/lib/auth.ts:48-85` (`getIdentity` decodifica
  el payload sin verificar firma), `apps/web/src/lib/portal-auth.ts:16-52`,
  `apps/web/src/lib/tenant-slug.ts:13-25`. Uso para gating de UI/redirect:
  `apps/web/src/pages/superadmin/index.astro:7-10`,
  `apps/web/src/pages/portal/approvals.astro:5-7` (`isApprover`),
  `apps/web/src/pages/portal/change-password.astro:2-3` (`mustChangePassword`).
- **Detalle:** Es **por diseño y está documentado** (auth.ts:5-13): la identidad
  decodificada solo personaliza UI; toda decisión dura la re-verifica la API. Un
  JWT forjado (firma inválida) pasaría estos checks de UI, pero **toda obtención
  de datos reenvía la cookie y la API rechaza la firma inválida**, por lo que no
  hay exposición de datos ni ejecución de acciones. El riesgo se limita a ver el
  "cascarón" del panel.
- **Riesgo / recomendación:** Mantener la invariante "nunca usar `getIdentity()`
  para una decisión que no esté respaldada por una llamada a la API". Verificar
  en el lado API que `isApprover` y `mustChangePassword` se imponen server-side
  (cubierto en la auditoría de `apps/api`).

#### B-2. Cuerpos de respuesta y objetos error en logs

- **Archivo:línea:** `apps/web/src/pages/api/auth/login.ts:32`
  (`console.error('[login] API returned ${res.status}:', body)`),
  `apps/web/src/pages/api/users/[id]/roles.ts:34`,
  `apps/web/src/pages/api/tenant-users/[id]/password.ts:30`,
  `apps/web/src/pages/api/payroll/[id]/xlsx.ts:151`.
- **Impacto:** Posible fuga de detalles internos de la API hacia logs del
  servidor (no se observó logueo de JWT, cookies ni contraseñas).
- **Remediación:** Loguear solo código de estado y un identificador; no volcar
  cuerpos completos ni objetos `err` en rutas de autenticación.

#### B-3. Credenciales SMTP del tenant en el proceso web (sin cifrado en reposo)

- **Archivo:línea:** `apps/web/src/lib/mailer.ts` (lee `mailUsername`/
  `mailPassword` desde `company_config` para enviar comprobantes con
  `nodemailer`). No se loguean ni se exponen al cliente, pero residen en memoria
  del proceso y provienen de la BD sin cifrado en reposo (mismo punto que la
  auditoría de la API).
- **Remediación:** Cifrar credenciales SMTP en reposo; descifrar solo al enviar.

---

## 3. Verificaciones que pasaron correctamente

- **Sin `dangerouslySetInnerHTML`** en componentes React/TSX (0 ocurrencias).
- **`set:html` de iconos SVG** usa un mapa **estático** del código, no datos de
  usuario (`apps/web/src/layouts/AppLayout.astro:1160,1169`).
- **3 de las inyecciones JSON en `<script>` SÍ escapan `<`** correctamente
  (`loans/new.astro:335`, `payroll/[id]/[lineId].astro:575`,
  `acumulados/index.astro:482`).
- **Atributos `data-*` interpolados** (`{expr}`) son auto-escapados por Astro y
  se consumen vía `dataset` + `textContent`; no constituyen XSS (verificado el
  patrón `data-sa-message`).
- **Plantillas de correo** escapan HTML explícitamente
  (`apps/web/src/lib/email-templates/payslip.ts` — función `escapeHtml`).
- **Comprobantes PDF** se generan con `@react-pdf/renderer` (contexto PDF, no
  HTML/DOM).
- **Página de login:** el query param `error` se valida contra una whitelist
  antes de mostrarse (`apps/web/src/pages/login.astro`), sin reflejo XSS.
- **`reset-password` (`define:vars`):** el `token` es hex puro generado por la
  API; no puede romper el contexto del script
  (`apps/web/src/pages/portal/reset-password.astro:108`).
- **Reenvío de cookie en login:** el web reenvía el `Set-Cookie` de la API tal
  cual, sin debilitar flags (`httpOnly`, `secure` en prod, `SameSite=Lax`)
  (`apps/web/src/pages/api/auth/login.ts:38-42`).
- **JWT no expuesto a JS del cliente:** cookie `auth` es `httpOnly`; no se
  encontró almacenamiento en `localStorage`/`sessionStorage` ni en atributos
  `data-*`.
- **Variables de entorno:** solo `PUBLIC_API_URL` se expone al cliente
  (`apps/web/src/lib/api.ts:2`), que es un endpoint, no un secreto. No hay
  secretos sensibles con prefijo `PUBLIC_`.
- **Aislamiento de proxies BFF:** reenvían la cookie y un `X-Tenant` derivado de
  la **propia** cookie del usuario; la API re-verifica firma y tenant, por lo que
  no hay cross-tenant explotable a través del proxy
  (`apps/web/src/pages/api/employees/index.ts`, patrón general).
- **Separación admin/portal:** cookies (`auth` vs `portal_auth`), layouts y
  ruteo por subdominio distintos; no se detectó confusión de sesiones
  (`apps/web/src/middleware.ts`).

### Falsos positivos / negativos descartados (de herramientas automáticas)

- **"XSS crítico en atributos `data-sa-message`":** descartado. Astro auto-escapa
  las expresiones `{}` en atributos; el valor se lee con `dataset` y se asigna
  vía `textContent`. No es explotable.
- **"Todos los `set:html` con `JSON.stringify` son seguros":** **incorrecto**.
  Tras verificación directa, cinco de ellos NO escapan `<` (ver A-1); solo tres
  lo hacen. El barrido automático generalizó de más.
- **"CSRF crítico":** recalibrado a MEDIO — `SameSite=Lax` en la cookie `auth`
  mitiga el CSRF por POST cross-site; el hallazgo real es la pérdida de defensa
  en profundidad (`checkOrigin: false`).
- **"JWT sin verificar = crítico":** recalibrado a BAJO — es por diseño y los
  datos están protegidos por la re-verificación de la API; el impacto se limita a
  UI.
