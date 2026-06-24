# Despliegue en Oracle Cloud (Always Free Tier) sobre CentOS

Manual paso a paso para instalar **todo el stack de PayrollSoft** desde cero
en una instancia del **free tier de Oracle Cloud Infrastructure (OCI)** que
corre **CentOS** (CentOS Stream 9; los pasos aplican casi igual a CentOS
Stream 8 y a **Oracle Linux 8/9**, que es RHEL-compatible).

A diferencia de [`DEPLOYMENT-UBUNTU-22.04.md`](./DEPLOYMENT-UBUNTU-22.04.md)
—que asume Ubuntu con Apache/PHP/MySQL ya instalados—, aquí partimos de una
**instancia recién creada y vacía sobre CentOS**. Las tres diferencias que
tumban más despliegues en este escenario son:

- El **doble firewall** de OCI: Security List de la VCN **+ firewalld** local.
- **SELinux**, que por defecto impide que Nginx haga de reverse proxy.
- Rutas y comandos RHEL (`dnf`, `/var/lib/pgsql/...`) distintos a Debian/Ubuntu.

El stack que queda corriendo:

| Componente    | Para qué sirve                       | Puerto interno         |
| ------------- | ------------------------------------ | ---------------------- |
| PostgreSQL 16 | Base de datos multi-tenant           | `5432` (solo loopback) |
| Bun ≥ 1.3     | Runtime de API y frontend SSR        | n/a                    |
| API (Elysia)  | Backend en `apps/api`                | `3000` (solo loopback) |
| Web (Astro)   | Frontend SSR en `apps/web`           | `4321` (solo loopback) |
| Nginx         | Reverse proxy + TLS                  | `80` / `443` (público) |
| systemd       | Mantiene API y Web vivos             | n/a                    |

---

## 1. Crear la instancia en Oracle Cloud

### 1.1. Elegir la forma de cómputo (compute shape)

El Always Free de Oracle ofrece dos familias. **La elección importa mucho**:

| Forma                       | Arquitectura | RAM         | ¿Recomendada?                                        |
| --------------------------- | ------------ | ----------- | ---------------------------------------------------- |
| **VM.Standard.A1.Flex**     | ARM aarch64  | hasta 24 GB | ✅ **Sí.** Hasta 4 OCPU + 24 GB siempre gratis.      |
| VM.Standard.E2.1.Micro      | x86_64       | 1 GB        | ⚠️ Solo si A1 no tiene capacidad. Requiere swap sí o sí. |

> **Bun corre nativo en ARM64**, así que la instancia Ampere A1 es la mejor
> opción: más RAM y CPU gratis. Configúrala con al menos **2 OCPU y 12 GB**
> (o los 4 OCPU / 24 GB completos si la capacidad lo permite).
>
> La x86 Micro (1 GB) **alcanza** para correr el sistema, pero `bun run build`
> puede quedarse sin memoria. Si te toca esa forma, la sección §3 (swap) deja
> de ser opcional.

### 1.2. Crear la instancia

En la consola de OCI → **Compute → Instances → Create instance**:

1. **Name**: `payrollsoft`.
2. **Image**: elige **CentOS Stream** (o, si no aparece, **Oracle Linux 9**,
   que es equivalente RHEL y sigue este manual igual).
3. **Shape**: `VM.Standard.A1.Flex` → 2–4 OCPU, 12–24 GB RAM.
4. **Networking**: crea una **VCN nueva** con **subred pública** y marca
   **"Assign a public IPv4 address"**.
5. **SSH keys**: sube tu clave pública (o descarga la que OCI genere).
6. **Boot volume**: 50 GB por defecto está bien (el free tier da hasta 200 GB).
7. **Create**.

Anota la **IP pública** cuando termine.

### 1.3. Primer acceso por SSH

El usuario por defecto depende de la imagen:

```bash
# Oracle Linux  → usuario 'opc'
ssh -i /ruta/a/tu-clave opc@<IP_PUBLICA>
# CentOS Stream → usuario 'cloud-user' (en algunas imágenes 'centos')
ssh -i /ruta/a/tu-clave cloud-user@<IP_PUBLICA>
```

Actualiza el sistema antes de seguir:

```bash
sudo dnf upgrade -y
```

---

## 2. Abrir el firewall — los DOS niveles de Oracle

⚠️ **Esta es la causa #1 de "instalé todo y no carga la página" en OCI.**
Oracle bloquea el tráfico en **dos capas independientes**. Hay que abrir el
puerto en **ambas** o el sitio nunca responderá desde afuera.

### 2.1. Nivel 1 — Security List de la VCN (en la consola web)

Consola OCI → **Networking → Virtual Cloud Networks → tu VCN → Subnet →
Security List → Add Ingress Rules**. Agrega:

| Source CIDR | IP Protocol | Destination Port |
| ----------- | ----------- | ---------------- |
| `0.0.0.0/0` | TCP         | `80`             |
| `0.0.0.0/0` | TCP         | `443`            |

(El `22` para SSH ya viene abierto.) **No** abras `3000`, `4321` ni `5432`.

### 2.2. Nivel 2 — firewalld en la instancia

Las imágenes CentOS/Oracle Linux de OCI traen **firewalld** activo que sólo
deja pasar SSH. Abre 80/443 también aquí:

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --list-all   # verifica que http y https aparecen en "services"
```

> Algunas imágenes antiguas de OCI usan **iptables** en vez de firewalld. Si
> `systemctl status firewalld` dice *inactive*, abre los puertos con:
> `sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT`,
> lo mismo para `443`, y persiste con `sudo netfilter-persistent save` (o
> `sudo service iptables save`).

### 2.3. Sincronizar el reloj

```bash
timedatectl status   # "System clock synchronized: yes"
# Si no: sudo dnf install -y chrony && sudo systemctl enable --now chronyd
```

---

## 3. (Recomendado) Configurar swap

Obligatorio en la Micro (1 GB) para que el build no muera por OOM; opcional
pero barato en la A1. 2 GB bastan:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirma que aparece swap
```

---

## 4. SELinux — preparar antes de instalar Nginx

CentOS trae **SELinux en modo `enforcing`**. Por defecto **bloquea que Nginx
(dominio `httpd_t`) abra conexiones de red hacia los backends** (API en :3000,
Web en :4321). Sin este booleano, Nginx devolverá **502** aunque todo lo demás
funcione. Actívalo ahora para no olvidarlo después:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

Comprueba el estado de SELinux (debería decir `enforcing`):

```bash
getenforce
```

> No desactives SELinux (`setenforce 0`) como "solución": el booleano de
> arriba es la forma correcta y mínima de permitir el proxy.

---

## 5. Instalar PostgreSQL 16

### 5.1. Agregar el repo oficial PGDG (RPM)

```bash
# Repo PGDG para Enterprise Linux 9 (CentOS Stream 9 / Oracle Linux 9)
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
# En instancia ARM (Ampere A1) usa el repo aarch64:
# sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-aarch64/pgdg-redhat-repo-latest.noarch.rpm

# Desactivar el módulo PostgreSQL del AppStream para que no choque con PGDG
sudo dnf -qy module disable postgresql
```

> Para CentOS/Oracle Linux **8**, cambia `EL-9-` por `EL-8-` en la URL.

### 5.2. Instalar el servidor e inicializar el cluster

```bash
sudo dnf install -y postgresql16-server postgresql16-contrib
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb
sudo systemctl enable --now postgresql-16
systemctl status postgresql-16 --no-pager
```

### 5.3. Crear base de datos y usuario de la app

```bash
sudo -u postgres psql <<SQL
CREATE USER payrollsoft WITH PASSWORD 'CAMBIA_ESTA_CLAVE_LARGA_Y_ALEATORIA';
CREATE DATABASE payroll_panama OWNER payrollsoft;
GRANT ALL PRIVILEGES ON DATABASE payroll_panama TO payrollsoft;
ALTER USER payrollsoft CREATEDB;  -- requerido por el provisioning de tenants
SQL
```

### 5.4. Restringir el acceso a localhost

En RHEL los archivos de config viven en el **data dir**, no en `/etc`.
Edita `/var/lib/pgsql/16/data/postgresql.conf`:

```conf
listen_addresses = 'localhost'
```

En `/var/lib/pgsql/16/data/pg_hba.conf`, deja solo:

```conf
local   all   all                     peer
host    all   all   127.0.0.1/32      scram-sha-256
host    all   all   ::1/128           scram-sha-256
```

Aplicar y verificar:

```bash
sudo systemctl restart postgresql-16
PGPASSWORD='LA_CLAVE_QUE_PUSISTE' psql -h 127.0.0.1 -U payrollsoft -d payroll_panama -c '\conninfo'
```

### 5.5. (Opcional) pgvector para reconocimiento facial

Solo si vas a usar el módulo de **asistencia por kiosko con reconocimiento
facial**. Si no, sáltalo: la migración detecta la ausencia de la extensión y
deja el módulo deshabilitado sin romper nada.

```bash
sudo dnf install -y pgvector_16
```

---

## 6. Instalar Bun

### 6.1. Crear el usuario de servicio

PayrollSoft corre como un usuario sin privilegios, no como `root`:

```bash
sudo useradd --system --create-home --shell /bin/bash payrollsoft
```

### 6.2. Instalar Bun para ese usuario

Bun necesita `unzip` para su instalador:

```bash
sudo dnf install -y unzip tar gzip
sudo -u payrollsoft -H bash -c 'curl -fsSL https://bun.sh/install | bash'
sudo -u payrollsoft -H bash -c '~/.bun/bin/bun --version'   # 1.3.x o superior
```

> En ARM A1, Bun descarga automáticamente el binario `aarch64`. Sin paso extra.

### 6.3. Hacer `bun` accesible para systemd

```bash
sudo ln -sf /home/payrollsoft/.bun/bin/bun /usr/local/bin/bun
bun --version
```

---

## 7. Obtener el código y configurar variables

### 7.1. Clonar el repositorio

```bash
sudo dnf install -y git
sudo -u payrollsoft -H git clone https://github.com/hiram-git/payrollsoft.git /home/payrollsoft/app
cd /home/payrollsoft/app
sudo -u payrollsoft git checkout main   # o el tag/rama a desplegar
```

### 7.2. Crear los directorios de storage y logs

```bash
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/lib/payrollsoft
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/lib/payrollsoft/storage
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/log/payrollsoft
```

### 7.3. Generar el archivo `.env`

Sustituye `payroll.tu-dominio.com` por tu dominio (o la IP pública si aún no
tienes dominio — ver nota en §10).

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
# Con un solo dominio y Nginx ruteando /api → API, incluye el sufijo /api:
PUBLIC_API_URL=https://payroll.tu-dominio.com/api

# ─── Cloudflare R2 (opcional — solo si payroll_report_mode=file_storage) ──
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
ENV
sudo chmod 600 /home/payrollsoft/app/.env
sudo chown payrollsoft:payrollsoft /home/payrollsoft/app/.env
```

Genera un `JWT_SECRET` seguro (≥ 32 chars) y pégalo en el `.env`:

```bash
openssl rand -hex 32
```

---

## 8. Instalar dependencias y compilar

```bash
cd /home/payrollsoft/app
sudo -u payrollsoft -H bun install --frozen-lockfile
sudo -u payrollsoft -H bun run build
```

El build produce:

- `apps/api/dist/index.js` — bundle del API
- `apps/web/dist/server/entry.mjs` + `apps/web/dist/client/` — SSR + assets

> Si el build muere con "Killed", casi siempre es OOM: revisa el swap (§3).

---

## 9. Migrar la base de datos y crear el super-admin

### 9.1. Migrar el schema central (`public` + `payroll_auth`)

```bash
cd /home/payrollsoft/app
sudo -u payrollsoft -H bun run --filter @payroll/db db:migrate:public
```

### 9.2. Seed inicial (crea el super-admin)

```bash
sudo -u payrollsoft -H bun run --filter @payroll/db db:seed
```

El seed imprime las credenciales del super-admin. **Anótalas**: son la única
forma de entrar a `/superadmin/login` y provisionar empresas.

---

## 10. Servicios systemd

Dos procesos: API + Web. Un unit file para cada uno.

### 10.1. Unit del API

```bash
sudo tee /etc/systemd/system/payrollsoft-api.service >/dev/null <<'UNIT'
[Unit]
Description=PayrollSoft API (Elysia/Bun)
After=network.target postgresql-16.service
Requires=postgresql-16.service

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

### 10.2. Unit del Web

```bash
sudo tee /etc/systemd/system/payrollsoft-web.service >/dev/null <<'UNIT'
[Unit]
Description=PayrollSoft Web (Astro SSR)
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

### 10.3. Habilitar, arrancar y verificar

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now payrollsoft-api payrollsoft-web
sudo systemctl status payrollsoft-api payrollsoft-web --no-pager
```

Confirma que escuchan en loopback:

```bash
curl -s http://127.0.0.1:3000/health      # {"status":"ok",...}
curl -sI http://127.0.0.1:4321/login      # HTTP/1.1 200 (o 302)
```

> Si SELinux bloqueara la lectura de binarios bajo `/home` para estos units
> (raro, pero posible en políticas estrictas), revisa `sudo ausearch -m avc -ts recent`.
> El caso común de SELinux aquí es el de Nginx (§4), no estos servicios.

---

## 11. Nginx como reverse proxy

Instalamos Nginx desde cero (instancia limpia):

```bash
sudo dnf install -y nginx
sudo systemctl enable nginx
```

Crea `/etc/nginx/conf.d/payrollsoft.conf` (en RHEL los sitios van en
`conf.d/`, no en `sites-available/`):

```bash
sudo tee /etc/nginx/conf.d/payrollsoft.conf >/dev/null <<'NGINX'
server {
    listen 80;
    server_name payroll.tu-dominio.com;

    # Límite de subida para adjuntos de expedientes
    client_max_body_size 10m;

    # 1) API en /api/* → http://127.0.0.1:3000 (sin el prefijo /api)
    location /api/ {
        proxy_pass         http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # 2) Frontend Astro SSR para todo lo demás → http://127.0.0.1:4321
    location / {
        proxy_pass         http://127.0.0.1:4321/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
NGINX
```

> El archivo por defecto de Nginx en RHEL trae un `server {}` en
> `/etc/nginx/nginx.conf`. Si choca por usar el mismo `listen 80 default_server`,
> comenta ese bloque dentro de `nginx.conf` o deja tu `server_name` explícito.

Valida y arranca:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

> **Recordatorio SELinux:** si ves **502 Bad Gateway** y los backends
> responden por `curl` local, casi seguro falta el booleano de §4:
> `sudo setsebool -P httpd_can_network_connect 1`.

> **¿Sin dominio todavía?** Para probar, pon `server_name _;` y usa
> `http://<IP_PUBLICA>` en el navegador, con `WEB_URL=http://<IP>` y
> `PUBLIC_API_URL=http://<IP>/api` en el `.env`. Para producción **necesitas
> un dominio** para el certificado de §12: apunta un registro **A** a la IP
> pública de la instancia.

---

## 12. Certificado TLS con Let's Encrypt

Requiere que el registro **A** de tu dominio ya apunte a la IP pública y que
80/443 estén abiertos en **ambos** firewalls (§2). En CentOS, certbot viene de
**EPEL**:

```bash
# EPEL: en CentOS Stream
sudo dnf install -y epel-release
# (en Oracle Linux 9 sería: sudo dnf install -y oracle-epel-release-el9)

sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d payroll.tu-dominio.com
```

Certbot edita el bloque de Nginx para escuchar en 443, instala el certificado
y configura el redirect 80→443. Verifica la renovación automática:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 13. Primer login

1. Abre `https://payroll.tu-dominio.com/superadmin/login`.
2. Usa las credenciales del super-admin impresas por `db:seed` (§9.2).
3. En el panel de super-admin, **provisiona un tenant** ("empresa") con su
   slug, nombre y el email + password del admin de esa empresa.
4. Cierra sesión, ve a `https://payroll.tu-dominio.com/login` y entra con las
   credenciales del admin del tenant.

> Si la provisión falla con "tenant migrations dir not found", confirma que la
> ruta de `Environment=TENANT_MIGRATIONS_DIR=...` (§10.1) existe y es legible
> por el usuario `payrollsoft`.

---

## 14. Backups

### 14.1. Dump diario de PostgreSQL

`/etc/cron.daily/payrollsoft-backup`:

```bash
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/var/backups/payrollsoft
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
sudo -u postgres /usr/pgsql-16/bin/pg_dump -Fc payroll_panama > "$BACKUP_DIR/payroll_panama_${TS}.dump"
find "$BACKUP_DIR" -name 'payroll_panama_*.dump' -mtime +14 -delete
```

```bash
sudo chmod +x /etc/cron.daily/payrollsoft-backup
# CentOS minimal puede no traer cron: sudo dnf install -y cronie && sudo systemctl enable --now crond
```

### 14.2. Storage de adjuntos

`STORAGE_DIR` (`/var/lib/payrollsoft/storage`) guarda los adjuntos de
expedientes y, en modo `local_storage`, los PDFs de planillas. Inclúyelo en tu
rotación de backups:

```bash
rsync -aH --delete /var/lib/payrollsoft/storage/ /mnt/backup/payrollsoft-storage/
```

> **Tip Oracle:** usa un **Block Volume** adicional del free tier (hasta 200 GB
> en total) montado en `/mnt/backup`, o sube los dumps a **OCI Object Storage**
> (también Always Free) con `oci-cli`.

---

## 15. Logs y troubleshooting

```bash
sudo journalctl -u payrollsoft-api -f
sudo journalctl -u payrollsoft-web -f
tail -f /var/log/payrollsoft/api.log /var/log/payrollsoft/web.log
sudo tail -f /var/log/nginx/error.log
sudo ausearch -m avc -ts recent   # ver denegaciones de SELinux
```

### Síntomas comunes (incluye los específicos de Oracle + CentOS)

| Síntoma                                              | Causa probable                                          | Cómo arreglar                                                          |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| La página no carga desde internet, pero `curl` local sí | Falta abrir 80/443 en **uno de los dos** firewalls       | Revisa §2.1 (Security List) **y** §2.2 (firewalld)                    |
| **502 Bad Gateway** y los backends sí responden local | **SELinux** bloquea a Nginx                             | `sudo setsebool -P httpd_can_network_connect 1` (§4)                  |
| 502 Bad Gateway y backend caído                     | `payrollsoft-api` o `-web` caído                        | `systemctl status payrollsoft-api payrollsoft-web`                    |
| Login da CSRF / 403                                 | `X-Forwarded-Proto` no llega al backend                 | Verifica el `proxy_set_header X-Forwarded-Proto` en Nginx            |
| Build muere con "Killed"                            | OOM (poca RAM)                                          | Activa swap (§3)                                                      |
| `❌ Invalid environment variables: JWT_SECRET`      | `JWT_SECRET` con < 32 chars                             | Regenera con `openssl rand -hex 32`                                  |
| `connect ECONNREFUSED 127.0.0.1:5432`               | PostgreSQL no corre / `pg_hba` no permite               | `systemctl status postgresql-16`                                     |
| Subida de adjunto da "EACCES"                       | `STORAGE_DIR` sin permisos                              | `sudo chown -R payrollsoft:payrollsoft /var/lib/payrollsoft`         |
| `bun: command not found` al instalar               | falta `unzip`                                           | `sudo dnf install -y unzip` y reinstala Bun (§6.2)                   |

---

## 16. Actualizaciones

```bash
cd /home/payrollsoft/app
sudo systemctl stop payrollsoft-web payrollsoft-api
sudo -u payrollsoft git fetch origin
sudo -u payrollsoft git checkout <rama-o-tag>
sudo -u payrollsoft bun install --frozen-lockfile
sudo -u payrollsoft bun run build
# Migraciones nuevas (idempotentes):
sudo -u payrollsoft bun run --filter @payroll/db db:migrate:public
sudo -u payrollsoft bun run --filter @payroll/db db:migrate:all-tenants
sudo systemctl start payrollsoft-api payrollsoft-web
sudo systemctl status payrollsoft-api payrollsoft-web --no-pager
```

> 💡 Haz el dump de §14.1 **antes** del `db:migrate:all-tenants`.

---

## 17. Checklist final

- [ ] `systemctl is-active payrollsoft-api payrollsoft-web postgresql-16 nginx` → `active` en todos.
- [ ] Reglas 80/443 presentes en la Security List de la VCN **y** en firewalld.
- [ ] `getsebool httpd_can_network_connect` → `on`.
- [ ] `curl -fs https://payroll.tu-dominio.com/api/health` devuelve `status: ok`.
- [ ] Login del super-admin funciona desde el navegador.
- [ ] Primer tenant provisionado y se entra a `/dashboard`.
- [ ] Crear un empleado, generar una planilla, cerrarla y descargar el PDF.
- [ ] `certbot renew --dry-run` pasa sin errores.
- [ ] Dump de §14.1 + storage de §14.2 bastan para reconstruir en otra máquina.

---

## Apéndice — Diferencias clave (CentOS/Oracle vs Ubuntu tradicional)

| Tema             | Ubuntu (doc tradicional)                   | CentOS en Oracle Free Tier                                   |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Paquetes         | `apt`                                      | `dnf` (repos PGDG/EPEL por RPM)                              |
| Reverse proxy    | Apache (ya instalado, se reutiliza)        | **Nginx** desde cero, en `/etc/nginx/conf.d/`               |
| Firewall local   | `ufw` (un nivel)                           | **firewalld** + Security List de la VCN (dos niveles)        |
| Seguridad extra  | —                                          | **SELinux**: `httpd_can_network_connect` para el proxy       |
| Config Postgres  | `/etc/postgresql/16/main/`                 | `/var/lib/pgsql/16/data/`                                    |
| Servicio PG      | `postgresql`                               | `postgresql-16`                                              |
| Arquitectura CPU | x86_64                                     | normalmente **ARM aarch64** (Ampere A1) — Bun corre nativo  |
| Memoria          | suele sobrar                               | ajustada en Micro → **swap** recomendado/obligatorio         |

Para el detalle de coexistencia con Apache/PHP/MySQL en Ubuntu, ver
[`DEPLOYMENT-UBUNTU-22.04.md`](./DEPLOYMENT-UBUNTU-22.04.md).
