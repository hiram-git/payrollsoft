# Despliegue en Ubuntu 22.04 LTS coexistiendo con Apache + PHP + MySQL

Manual paso a paso para instalar PayrollSoft en un servidor Ubuntu 22.04 LTS
que **ya tiene Apache sirviendo aplicaciones PHP 8.2 y PHP 5.3** y **dos
servidores MySQL en paralelo (5.7 y 8.0)**.

PayrollSoft no es PHP ni usa MySQL — corre sobre **Bun** (runtime de
JavaScript/TypeScript) y **PostgreSQL**. La estrategia es instalar el
stack nuevo al lado del existente sin tocarlo, y exponer la aplicación
vía Apache usando un VirtualHost con `mod_proxy_http` en un dominio o
subdominio propio.

---

## 1. Resumen de arquitectura

### 1.1. Componentes que se instalan

| Componente   | Para qué sirve                          | Puerto interno |
| ------------ | --------------------------------------- | -------------- |
| PostgreSQL 16| Base de datos del sistema               | `5432`         |
| Bun ≥ 1.3    | Runtime de la API y del frontend SSR    | n/a            |
| API service  | Backend Elysia (Bun) en `apps/api`      | `3000`         |
| Web service  | Frontend Astro SSR en `apps/web`        | `4321`         |
| Apache 2.4   | Reverse proxy hacia los dos servicios   | `80`/`443` ya en uso |
| systemd      | Mantiene API y Web corriendo y reinicia | n/a            |

### 1.2. Coexistencia con lo existente

- **Apache**: se agregan dos `VirtualHost` nuevos (`payroll.tu-dominio.com`
  y `api-payroll.tu-dominio.com` — o un único host con `/api` proxied).
  Los `VirtualHost` PHP existentes no se tocan.
- **PHP 8.2 y 5.3**: irrelevantes para PayrollSoft. Quedan tal cual.
- **MySQL 5.7 y 8.0**: irrelevantes. PostgreSQL escucha en `5432`,
  MySQL sigue en `3306` (y los puertos adicionales del segundo MySQL).
  No hay conflicto.
- **Puertos**: PayrollSoft solo abre `5432` (PostgreSQL, ideal localhost
  únicamente), `3000` (API) y `4321` (Web). Los tres son loopback —
  Apache los proxiea hacia el público.

### 1.3. Diagrama lógico

```
                Internet
                    │
                    ▼
            ┌─────────────────┐
            │    Apache 2.4    │  80 / 443 (ya existentes)
            │  ──────────────  │
            │  VHost PHP 8.2   │──► fastcgi → php8.2-fpm
            │  VHost PHP 5.3   │──► fastcgi → php5.3-fpm
            │  VHost Payroll   │──► proxy   → :4321 (Astro SSR)
            │     └ /api/*     │──► proxy   → :3000 (Elysia API)
            └─────────────────┘
                    │
                    ├──► PostgreSQL 16  (localhost:5432)
                    ├──► MySQL 5.7      (localhost:3306)   ← no se toca
                    └──► MySQL 8.0      (localhost:3307)   ← no se toca
```

---

## 2. Pre-requisitos en el servidor

### 2.1. Verificar el sistema operativo

```bash
lsb_release -a
# Debe decir: Ubuntu 22.04.x LTS
uname -m
# Debe decir: x86_64 (Bun no tiene binario oficial para arm32; arm64 sí)
```

### 2.2. Verificar que Apache esté corriendo y los puertos libres

```bash
systemctl status apache2
sudo ss -tlnp | grep -E ':(80|443|3000|3306|4321|5432) '
```

- Confirma que `:80` y `:443` los tiene **apache2** (no nginx).
- Confirma que `:3000`, `:4321` y `:5432` están **libres** (sin proceso).
- Si alguno está ocupado, planifica un puerto alternativo y actualiza
  los `.env` y la config de Apache que aparecen más abajo.

### 2.3. Verificar módulos de Apache habilitados

```bash
sudo a2query -m | grep -E 'proxy|proxy_http|headers|ssl|rewrite'
```

Deben aparecer (si no, instalarlos):

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo systemctl reload apache2
```

### 2.4. Sincronizar reloj del sistema

Las planillas y aprobaciones dependen de timestamps. Asegúrate de que
`chrony` o `systemd-timesyncd` están activos:

```bash
timedatectl status
# Verifica: "System clock synchronized: yes"
```

---

## 3. Instalación de PostgreSQL 16

> ⚠️ **No reemplaza ni toca MySQL.** PostgreSQL es otro motor que vive
> en `:5432` en paralelo a tus MySQL en `:3306`/`:3307`.

### 3.1. Agregar el repo oficial de PGDG

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
sudo apt update
```

### 3.2. Instalar el servidor

```bash
sudo apt install -y postgresql-16 postgresql-contrib-16
sudo systemctl enable --now postgresql
systemctl status postgresql
```

### 3.3. Crear base de datos y usuario de la app

```bash
sudo -u postgres psql <<SQL
CREATE USER payrollsoft WITH PASSWORD 'CAMBIA_ESTA_CLAVE_LARGA_Y_ALEATORIA';
CREATE DATABASE payroll_panama OWNER payrollsoft;
GRANT ALL PRIVILEGES ON DATABASE payroll_panama TO payrollsoft;
ALTER USER payrollsoft CREATEDB;  -- requerido por el provisioning de tenants
SQL
```

### 3.4. Restringir el acceso a localhost

Edita `/etc/postgresql/16/main/postgresql.conf`:

```conf
listen_addresses = 'localhost'
```

Y `/etc/postgresql/16/main/pg_hba.conf`, deja solo:

```conf
local   all             all                                     peer
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
```

Aplicar:

```bash
sudo systemctl restart postgresql
```

### 3.5. Verificar conexión

```bash
PGPASSWORD='LA_CLAVE_QUE_PUSISTE' psql -h 127.0.0.1 -U payrollsoft -d payroll_panama -c '\conninfo'
```

### 3.6. (Opcional) Instalar pgvector para el módulo de reconocimiento facial

El módulo de **reconocimiento facial** (asistencia por kiosko) usa la
extensión `pgvector` para almacenar embeddings 128-d con búsqueda
KNN coseno. **Si no piensas usar este módulo, puedes saltarte este
paso** — la migración `0034_facial_recognition` detecta automáticamente
la ausencia de la extensión y deja el módulo deshabilitado sin
romper el resto del sistema.

Para habilitarlo:

```bash
sudo apt install -y postgresql-16-pgvector
```

> Cambia `postgresql-16-pgvector` por la versión que corresponda a tu
> PostgreSQL (`postgresql-15-pgvector`, `postgresql-17-pgvector`...).
> Si tu versión no está en los repos oficiales, sigue las
> instrucciones de https://github.com/pgvector/pgvector

Después, **si ya provisionaste tenants** sin pgvector, re-corre la
migración 0034 manualmente para que ahora SÍ cree las tablas facial:

```bash
# Para cada tenant que ya existe
sudo -u postgres psql -d payroll_panama <<'SQL'
  DO $$
  DECLARE tenant_schema text;
  BEGIN
    FOR tenant_schema IN
      SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%'
    LOOP
      EXECUTE format(
        'DELETE FROM %I.__drizzle_migrations WHERE hash LIKE %L',
        tenant_schema, '%0034%'
      );
      RAISE NOTICE 'Cleared 0034 entry from %', tenant_schema;
    END LOOP;
  END $$;
SQL

bun run --filter @payroll/db db:migrate:all-tenants
```

Tenants provisionados *después* de instalar pgvector tendrán las
tablas facial automáticamente sin ningún paso extra.

---

## 4. Instalación de Bun

### 4.1. Crear el usuario del servicio

Por seguridad, PayrollSoft corre como un usuario sin privilegios — no
como `root` ni como `www-data`.

```bash
sudo useradd --system --create-home --shell /bin/bash payrollsoft
sudo usermod -aG payrollsoft www-data   # opcional: permite a Apache leer logs
```

### 4.2. Instalar Bun para ese usuario

```bash
sudo -u payrollsoft -H bash -c 'curl -fsSL https://bun.sh/install | bash'
sudo -u payrollsoft -H bash -c '~/.bun/bin/bun --version'
# Salida esperada: 1.3.x o superior
```

### 4.3. Hacer `bun` accesible para systemd

```bash
sudo ln -sf /home/payrollsoft/.bun/bin/bun /usr/local/bin/bun
bun --version
```

---

## 5. Obtener el código y configurar variables

### 5.1. Clonar el repositorio

```bash
sudo -u payrollsoft -H git clone https://github.com/hiram-git/payrollsoft.git /home/payrollsoft/app
cd /home/payrollsoft/app
sudo -u payrollsoft git checkout main   # o la rama/tag que vayas a desplegar
```

### 5.2. Crear el directorio de storage

```bash
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/lib/payrollsoft
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/lib/payrollsoft/storage
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/log/payrollsoft
```

### 5.3. Generar el archivo `.env`

```bash
sudo -u payrollsoft -H tee /home/payrollsoft/app/.env >/dev/null <<'ENV'
# ─── Entorno ──────────────────────────────────────────────────────────
NODE_ENV=production

# ─── API ───────────────────────────────────────────────────────────────
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://payrollsoft:CAMBIA_ESTA_CLAVE_LARGA_Y_ALEATORIA@127.0.0.1:5432/payroll_panama
JWT_SECRET=GENERA_UNA_CADENA_DE_64_CARACTERES_ALEATORIOS_CON_OPENSSL
WEB_URL=https://payroll.tu-dominio.com

# ─── Storage (adjuntos de expedientes y PDFs en modo local_storage) ──
STORAGE_DIR=/var/lib/payrollsoft/storage

# ─── Web ───────────────────────────────────────────────────────────────
PUBLIC_API_URL=https://payroll.tu-dominio.com

# ─── Cloudflare R2 (opcional — solo si payroll_report_mode=file_storage)
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
ENV
sudo chmod 600 /home/payrollsoft/app/.env
sudo chown payrollsoft:payrollsoft /home/payrollsoft/app/.env
```

Generar un JWT_SECRET seguro:

```bash
openssl rand -hex 32
# Pegar el resultado en JWT_SECRET=...
```

> ⚠️ **Importante**: `WEB_URL` y `PUBLIC_API_URL` apuntan al **mismo
> host público** porque Apache rutea `/api/*` al API y todo lo demás
> al frontend (ver §9). Si decides usar dos subdominios separados
> (`payroll.tu-dominio.com` y `api-payroll.tu-dominio.com`),
> ajusta `PUBLIC_API_URL` al subdominio del API.

---

## 6. Instalar dependencias y compilar

```bash
cd /home/payrollsoft/app
sudo -u payrollsoft -H bun install --frozen-lockfile
sudo -u payrollsoft -H bun run build
```

El build produce:

- `apps/api/dist/index.js` — bundle del API
- `apps/web/dist/server/entry.mjs` + `apps/web/dist/client/` — SSR + assets

---

## 7. Migrar la base de datos

### 7.1. Migración del schema central (`public` + `payroll_auth`)

```bash
cd /home/payrollsoft/app
sudo -u payrollsoft -H bun run --filter @payroll/db db:migrate:public
```

### 7.2. Seed inicial (crea el super-admin)

```bash
sudo -u payrollsoft -H bun run --filter @payroll/db db:seed
```

El seed te imprime las credenciales del super-admin por consola.
**Anótalas** — son la única forma de entrar a `/superadmin/login` y
provisionar tenants.

### 7.3. (Opcional) Provisionar un primer tenant

Esto lo harás luego desde la UI en `https://payroll.tu-dominio.com/superadmin`.
No es parte de la instalación del sistema operativo.

---

## 8. Servicios systemd

PayrollSoft son dos procesos (API + Web). Cada uno con su unit file.

### 8.1. Unit del API

```bash
sudo tee /etc/systemd/system/payrollsoft-api.service >/dev/null <<'UNIT'
[Unit]
Description=PayrollSoft API (Elysia/Bun)
Documentation=https://github.com/hiram-git/payrollsoft
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=payrollsoft
Group=payrollsoft
WorkingDirectory=/home/payrollsoft/app/apps/api
EnvironmentFile=/home/payrollsoft/app/.env
Environment=TENANT_MIGRATIONS_DIR=/home/payrollsoft/app/packages/db/drizzle/tenant
ExecStart=/usr/local/bin/bun run dist/index.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/payrollsoft/api.log
StandardError=append:/var/log/payrollsoft/api.err.log

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/payrollsoft /var/log/payrollsoft /home/payrollsoft/app
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
```

### 8.2. Unit del Web

```bash
sudo tee /etc/systemd/system/payrollsoft-web.service >/dev/null <<'UNIT'
[Unit]
Description=PayrollSoft Web (Astro SSR)
Documentation=https://github.com/hiram-git/payrollsoft
After=network.target payrollsoft-api.service
Requires=payrollsoft-api.service

[Service]
Type=simple
User=payrollsoft
Group=payrollsoft
WorkingDirectory=/home/payrollsoft/app/apps/web
EnvironmentFile=/home/payrollsoft/app/.env
Environment=HOST=127.0.0.1
Environment=PORT=4321
ExecStart=/usr/local/bin/bun run dist/server/entry.mjs
Restart=always
RestartSec=5
StandardOutput=append:/var/log/payrollsoft/web.log
StandardError=append:/var/log/payrollsoft/web.err.log

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/log/payrollsoft /home/payrollsoft/app
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
```

### 8.3. Habilitar y arrancar

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now payrollsoft-api payrollsoft-web
sudo systemctl status payrollsoft-api payrollsoft-web --no-pager
```

### 8.4. Verificar que están escuchando localmente

```bash
curl -s http://127.0.0.1:3000/health
# Esperado: {"status":"ok","tenant":"public","version":"2.0.0","timestamp":"..."}
curl -sI http://127.0.0.1:4321/login
# Esperado: HTTP/1.1 200 OK (o 302 hacia login si la sesión no aplica)
```

---

## 9. Configurar Apache como reverse proxy

Sin tocar tus VHosts PHP existentes, creamos uno nuevo para PayrollSoft.

### 9.1. Estrategia A — un solo dominio (recomendada)

`/etc/apache2/sites-available/payrollsoft.conf`:

```apache
<VirtualHost *:80>
    ServerName payroll.tu-dominio.com
    Redirect permanent / https://payroll.tu-dominio.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName payroll.tu-dominio.com

    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/payroll.tu-dominio.com/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/payroll.tu-dominio.com/privkey.pem
    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLHonorCipherOrder on

    # Logs separados de los VHosts PHP
    ErrorLog    ${APACHE_LOG_DIR}/payrollsoft_error.log
    CustomLog   ${APACHE_LOG_DIR}/payrollsoft_access.log combined

    # Pasar IP real y esquema HTTPS al backend
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port  "443"

    ProxyPreserveHost On
    ProxyRequests Off

    # 1) API en /api/*  → http://127.0.0.1:3000
    #    Reescribimos para que llegue al API sin el prefijo /api.
    ProxyPass         /api/  http://127.0.0.1:3000/  nocanon
    ProxyPassReverse  /api/  http://127.0.0.1:3000/

    # 2) Frontend Astro SSR para todo lo demás → http://127.0.0.1:4321
    ProxyPass         /  http://127.0.0.1:4321/  nocanon
    ProxyPassReverse  /  http://127.0.0.1:4321/

    # Subir el límite por defecto de Apache para uploads de adjuntos
    LimitRequestBody 10485760   # 10 MB
</VirtualHost>
```

> **Atención**: con la Estrategia A el `PUBLIC_API_URL` del `.env` debe
> incluir el sufijo `/api`:
> `PUBLIC_API_URL=https://payroll.tu-dominio.com/api`
> Y `WEB_URL=https://payroll.tu-dominio.com`.

### 9.2. Estrategia B — dos subdominios

Si prefieres separar API y Web en hosts distintos:

```apache
<VirtualHost *:443>
    ServerName api-payroll.tu-dominio.com
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/api-payroll.tu-dominio.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/api-payroll.tu-dominio.com/privkey.pem

    RequestHeader set X-Forwarded-Proto "https"
    ProxyPreserveHost On
    ProxyPass         /  http://127.0.0.1:3000/  nocanon
    ProxyPassReverse  /  http://127.0.0.1:3000/

    ErrorLog    ${APACHE_LOG_DIR}/payrollsoft_api_error.log
    CustomLog   ${APACHE_LOG_DIR}/payrollsoft_api_access.log combined
</VirtualHost>

<VirtualHost *:443>
    ServerName payroll.tu-dominio.com
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/payroll.tu-dominio.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/payroll.tu-dominio.com/privkey.pem

    RequestHeader set X-Forwarded-Proto "https"
    ProxyPreserveHost On
    ProxyPass         /  http://127.0.0.1:4321/  nocanon
    ProxyPassReverse  /  http://127.0.0.1:4321/

    ErrorLog    ${APACHE_LOG_DIR}/payrollsoft_web_error.log
    CustomLog   ${APACHE_LOG_DIR}/payrollsoft_web_access.log combined
</VirtualHost>
```

Con esto el `.env` queda:

```
WEB_URL=https://payroll.tu-dominio.com
PUBLIC_API_URL=https://api-payroll.tu-dominio.com
```

### 9.3. Activar el sitio

```bash
sudo a2ensite payrollsoft.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

---

## 10. Certificados SSL con Let's Encrypt

Si todavía no tienes certbot:

```bash
sudo apt install -y certbot python3-certbot-apache
```

Emitir certificado (Estrategia A):

```bash
sudo certbot --apache -d payroll.tu-dominio.com
```

Estrategia B (dos subdominios):

```bash
sudo certbot --apache -d payroll.tu-dominio.com -d api-payroll.tu-dominio.com
```

Verifica la renovación automática:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 11. Apertura del firewall

Si tienes `ufw` activo, solo abrir los puertos públicos. Los puertos
`3000`, `4321` y `5432` NO se exponen:

```bash
sudo ufw status
sudo ufw allow 'Apache Full'   # 80 + 443
sudo ufw reload
```

---

## 12. Primer login

1. Abre en el navegador `https://payroll.tu-dominio.com/superadmin/login`.
2. Usa las credenciales del super-admin impresas por `db:seed` en §7.2.
3. En el panel del super-admin, **provisionar un tenant** ("empresa")
   con un slug, nombre, email + password del admin del tenant.
4. Cerrar sesión, ir a `https://payroll.tu-dominio.com/login` y entrar
   con las credenciales del admin del tenant.

> Si el flujo de provisión falla con "tenant migrations dir not found",
> revisa que el `Environment=TENANT_MIGRATIONS_DIR=...` del unit del API
> exista en disco con el usuario `payrollsoft`.

---

## 13. Backups

### 13.1. Dump diario de PostgreSQL

`/etc/cron.daily/payrollsoft-backup`:

```bash
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/var/backups/payrollsoft
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump -Fc payroll_panama \
  > "$BACKUP_DIR/payroll_panama_${TS}.dump"
# Conservar 14 días
find "$BACKUP_DIR" -name 'payroll_panama_*.dump' -mtime +14 -delete
```

```bash
sudo chmod +x /etc/cron.daily/payrollsoft-backup
```

### 13.2. Storage de adjuntos

`STORAGE_DIR` (`/var/lib/payrollsoft/storage`) contiene los adjuntos
de expedientes y, si activaste `local_storage`, los PDFs de planillas.
Incluyelo en tu rotación de backups (rsync, restic, borg, etc.):

```bash
# Ejemplo con rsync incremental hacia un disco montado
rsync -aH --delete /var/lib/payrollsoft/storage/ /mnt/backup/payrollsoft-storage/
```

---

## 14. Logs y troubleshooting

### 14.1. Ver logs en vivo

```bash
sudo journalctl -u payrollsoft-api  -f
sudo journalctl -u payrollsoft-web  -f
tail -f /var/log/payrollsoft/api.log /var/log/payrollsoft/web.log
tail -f /var/log/apache2/payrollsoft_error.log
```

### 14.2. Reinicios manuales

```bash
sudo systemctl restart payrollsoft-api
sudo systemctl restart payrollsoft-web
sudo systemctl reload apache2
```

### 14.3. Health check

```bash
curl -fs https://payroll.tu-dominio.com/api/health | jq
```

### 14.4. Síntomas comunes

| Síntoma                                            | Causa probable                                              | Cómo verificar / arreglar                                          |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 502 Bad Gateway desde Apache                       | `payrollsoft-api` o `-web` caído                            | `systemctl status payrollsoft-api`                                 |
| Login da CSRF / 403                                | `X-Forwarded-Proto` no llega al backend                     | Verifica `RequestHeader set X-Forwarded-Proto "https"` en el VHost |
| `❌ Invalid environment variables: JWT_SECRET`     | `JWT_SECRET` tiene < 32 chars                               | Regenera con `openssl rand -hex 32` en el `.env`                   |
| `connect ECONNREFUSED 127.0.0.1:5432`              | PostgreSQL no corre o `pg_hba` no permite                   | `systemctl status postgresql`                                      |
| Subida de adjunto da "EACCES"                      | `STORAGE_DIR` sin permisos para `payrollsoft`               | `chown -R payrollsoft:payrollsoft /var/lib/payrollsoft`            |
| `provisionTenant` falla con "migrations not found" | `TENANT_MIGRATIONS_DIR` mal configurado en el unit          | Ver §8.1 — la ruta debe ser absoluta                               |

---

## 15. Actualizaciones

```bash
cd /home/payrollsoft/app
sudo systemctl stop payrollsoft-web payrollsoft-api
sudo -u payrollsoft git fetch origin
sudo -u payrollsoft git checkout <rama-o-tag>
sudo -u payrollsoft bun install --frozen-lockfile
sudo -u payrollsoft bun run build
# Aplicar migraciones nuevas (idempotentes):
sudo -u payrollsoft bun run --filter @payroll/db db:migrate:public
sudo -u payrollsoft bun run --filter @payroll/db db:migrate:all-tenants
sudo systemctl start payrollsoft-api payrollsoft-web
sudo systemctl status payrollsoft-api payrollsoft-web --no-pager
```

> 💡 **Recomendado**: hacer el dump de PostgreSQL (§13.1) **antes** del
> `db:migrate:all-tenants`. Las migraciones de Drizzle son lineales
> pero un rollback es siempre más limpio desde un dump fresco.

---

## 16. Checklist final post-instalación

- [ ] `systemctl is-active payrollsoft-api payrollsoft-web postgresql apache2` → `active` en todos.
- [ ] `curl -fs https://payroll.tu-dominio.com/api/health` devuelve JSON `status: ok`.
- [ ] Login del super-admin funciona desde el navegador.
- [ ] Primer tenant provisionado y se puede entrar a `/dashboard`.
- [ ] Crear un empleado de prueba.
- [ ] Generar una planilla regular, cerrarla, descargar el PDF.
- [ ] Crear un expediente con un adjunto — verificar que aparece en
      `/var/lib/payrollsoft/storage/<tenant>_storage/employee_files/`.
- [ ] Hacer una solicitud de vacaciones, aprobarla y confirmar que se
      generó la planilla automática (§módulo de vacaciones).
- [ ] Restaurar mentalmente un backup: el dump de §13.1 + el storage
      de §13.2 deben ser suficientes para reconstruir el sistema desde
      cero en otra máquina.

---

## Apéndice A — Variables de entorno

| Variable                | Obligatoria | Default         | Descripción                                              |
| ----------------------- | ----------- | --------------- | -------------------------------------------------------- |
| `NODE_ENV`              | Sí          | `development`   | `production` en servidor                                 |
| `HOST`                  | Sí          | `0.0.0.0`       | Ponerlo en `127.0.0.1` cuando hay reverse proxy           |
| `PORT`                  | Sí          | `3000`          | Puerto interno del API                                   |
| `DATABASE_URL`          | Sí          | —               | Cadena PostgreSQL                                        |
| `JWT_SECRET`            | Sí          | —               | ≥ 32 chars, generar con `openssl rand -hex 32`           |
| `WEB_URL`               | Sí          | `localhost:4321`| URL pública del frontend (usada en mails)                 |
| `PUBLIC_API_URL`        | Sí (Web)    | `localhost:3000`| URL pública del API (lo que el navegador llama)          |
| `STORAGE_DIR`           | Recomendado | `/tmp/...`      | Raíz de adjuntos y PDFs locales                          |
| `TENANT_MIGRATIONS_DIR` | Sí (build)  | —               | Ruta absoluta a `packages/db/drizzle/tenant`             |
| `R2_*`                  | Opcional    | —               | Solo si algún tenant usa `payroll_report_mode=file_storage` |

## Apéndice B — Puertos y permisos

| Recurso                            | Usuario       | Permisos | Quién accede           |
| ---------------------------------- | ------------- | -------- | ---------------------- |
| `/home/payrollsoft/app`            | `payrollsoft` | `755`    | systemd                |
| `/home/payrollsoft/app/.env`       | `payrollsoft` | `600`    | systemd                |
| `/var/lib/payrollsoft/storage`     | `payrollsoft` | `750`    | API                    |
| `/var/log/payrollsoft`             | `payrollsoft` | `750`    | journald + tail manual |
| TCP `5432`                         | postgres      | localhost only | API                    |
| TCP `3000`                         | payrollsoft   | localhost only | Apache                 |
| TCP `4321`                         | payrollsoft   | localhost only | Apache                 |

## Apéndice C — Desinstalación

```bash
sudo systemctl disable --now payrollsoft-web payrollsoft-api
sudo rm /etc/systemd/system/payrollsoft-{api,web}.service
sudo systemctl daemon-reload
sudo a2dissite payrollsoft.conf
sudo rm /etc/apache2/sites-available/payrollsoft.conf
sudo systemctl reload apache2
sudo -u postgres dropdb payroll_panama
sudo -u postgres dropuser payrollsoft
sudo userdel -r payrollsoft
sudo rm -rf /var/lib/payrollsoft /var/log/payrollsoft
```

Nada de lo anterior afecta Apache, PHP, MySQL ni las aplicaciones
existentes en el servidor.
