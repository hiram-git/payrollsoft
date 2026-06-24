# Despliegue en Oracle Cloud (Always Free Tier)

Manual paso a paso para instalar **todo el stack de PayrollSoft** desde cero
en una instancia del **free tier de Oracle Cloud Infrastructure (OCI)**.

A diferencia de [`DEPLOYMENT-UBUNTU-22.04.md`](./DEPLOYMENT-UBUNTU-22.04.md)
—que asume un servidor ya poblado con Apache/PHP/MySQL—, este manual parte de
una **instancia recién creada y vacía**. Por eso usamos **Nginx** como reverse
proxy (no hay Apache que reutilizar) y dedicamos secciones a las
particularidades de Oracle que tumban más despliegues:

- El **doble firewall** de OCI (Security List de la VCN **+** iptables local).
- La elección de **forma de cómputo** (ARM Ampere A1 vs x86 Micro).
- **Swap** para que los builds no mueran por OOM en instancias chicas.

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

| Forma                       | Arquitectura | RAM        | ¿Recomendada?                                        |
| --------------------------- | ------------ | ---------- | ---------------------------------------------------- |
| **VM.Standard.A1.Flex**     | ARM aarch64  | hasta 24 GB | ✅ **Sí.** Hasta 4 OCPU + 24 GB siempre gratis.      |
| VM.Standard.E2.1.Micro      | x86_64       | 1 GB       | ⚠️ Solo si A1 no tiene capacidad. Requiere swap sí o sí. |

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
2. **Image**: cambia a **Canonical Ubuntu 22.04** (no uses Oracle Linux para
   seguir este manual al pie de la letra).
3. **Shape**: `VM.Standard.A1.Flex` → 2–4 OCPU, 12–24 GB RAM.
4. **Networking**: crea una **VCN nueva** (o usa una existente) con
   **subred pública** y marca **"Assign a public IPv4 address"**.
5. **SSH keys**: sube tu clave pública (o deja que OCI genere un par y
   **descarga la privada** — la necesitarás para entrar).
6. **Boot volume**: 50 GB por defecto está bien (el free tier da hasta 200 GB).
7. **Create**.

Cuando termine, anota la **IP pública** de la instancia.

### 1.3. Primer acceso por SSH

```bash
# En Ubuntu el usuario por defecto es 'ubuntu'
ssh -i /ruta/a/tu-clave-privada ubuntu@<IP_PUBLICA>
```

Actualiza el sistema antes de seguir:

```bash
sudo apt update && sudo apt upgrade -y
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

(El `22` para SSH ya viene abierto por defecto.) **No** abras `3000`, `4321`
ni `5432`: esos quedan internos.

### 2.2. Nivel 2 — Firewall local de la instancia

Las imágenes Ubuntu de OCI traen reglas **iptables** que rechazan todo lo que
no sea SSH, incluso después de abrir la Security List. Hay que abrir 80/443
también aquí. Inserta las reglas **antes** de la regla REJECT final:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
# Persistir tras reinicios:
sudo netfilter-persistent save
```

Verifica que las reglas quedaron por encima del REJECT:

```bash
sudo iptables -L INPUT -n --line-numbers | grep -E 'dpt:(80|443)|REJECT'
```

> **Alternativa con ufw:** si prefieres `ufw`, primero hay que neutralizar las
> reglas iptables de Oracle (`sudo iptables -F INPUT` + borrar
> `/etc/iptables/rules.v4`), luego `sudo apt install -y ufw`,
> `sudo ufw allow OpenSSH`, `sudo ufw allow 80,443/tcp` y `sudo ufw enable`.
> Hazlo con cuidado: si flusheas iptables sin reabrir el 22 te quedas fuera.
> Por simplicidad, este manual se queda con el enfoque iptables de arriba.

### 2.3. Sincronizar el reloj

Las planillas y aprobaciones dependen de timestamps correctos:

```bash
timedatectl status   # "System clock synchronized: yes"
```

---

## 3. (Recomendado) Configurar swap

En la instancia Micro (1 GB) el swap es **obligatorio** para que el build no
muera por OOM. En la A1 con ≥ 12 GB es opcional pero barato como red de
seguridad. 2 GB son suficientes:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirma que aparece swap
```

---

## 4. Instalar PostgreSQL 16

### 4.1. Agregar el repo oficial PGDG

```bash
sudo apt install -y curl ca-certificates gnupg
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
sudo apt update
```

### 4.2. Instalar el servidor

```bash
sudo apt install -y postgresql-16 postgresql-contrib-16
sudo systemctl enable --now postgresql
systemctl status postgresql --no-pager
```

### 4.3. Crear base de datos y usuario de la app

```bash
sudo -u postgres psql <<SQL
CREATE USER payrollsoft WITH PASSWORD 'CAMBIA_ESTA_CLAVE_LARGA_Y_ALEATORIA';
CREATE DATABASE payroll_panama OWNER payrollsoft;
GRANT ALL PRIVILEGES ON DATABASE payroll_panama TO payrollsoft;
ALTER USER payrollsoft CREATEDB;  -- requerido por el provisioning de tenants
SQL
```

### 4.4. Restringir el acceso a localhost

PostgreSQL nunca debe ser accesible desde internet. Edita
`/etc/postgresql/16/main/postgresql.conf`:

```conf
listen_addresses = 'localhost'
```

En `/etc/postgresql/16/main/pg_hba.conf`, deja solo:

```conf
local   all   all                     peer
host    all   all   127.0.0.1/32      scram-sha-256
host    all   all   ::1/128           scram-sha-256
```

Aplicar y verificar:

```bash
sudo systemctl restart postgresql
PGPASSWORD='LA_CLAVE_QUE_PUSISTE' psql -h 127.0.0.1 -U payrollsoft -d payroll_panama -c '\conninfo'
```

### 4.5. (Opcional) pgvector para reconocimiento facial

Solo si vas a usar el módulo de **asistencia por kiosko con reconocimiento
facial** (embeddings 128-d con búsqueda KNN coseno). Si no, sáltalo: la
migración correspondiente detecta la ausencia de la extensión y deja el
módulo deshabilitado sin romper nada.

```bash
sudo apt install -y postgresql-16-pgvector
```

---

## 5. Instalar Bun

### 5.1. Crear el usuario de servicio

PayrollSoft corre como un usuario sin privilegios, no como `root`:

```bash
sudo useradd --system --create-home --shell /bin/bash payrollsoft
```

### 5.2. Instalar Bun para ese usuario

```bash
sudo -u payrollsoft -H bash -c 'curl -fsSL https://bun.sh/install | bash'
sudo -u payrollsoft -H bash -c '~/.bun/bin/bun --version'   # 1.3.x o superior
```

> En ARM A1, Bun descarga automáticamente el binario `aarch64`. No hay paso
> extra: funciona igual que en x86.

### 5.3. Hacer `bun` accesible para systemd

```bash
sudo ln -sf /home/payrollsoft/.bun/bin/bun /usr/local/bin/bun
bun --version
```

---

## 6. Obtener el código y configurar variables

### 6.1. Clonar el repositorio

```bash
sudo apt install -y git
sudo -u payrollsoft -H git clone https://github.com/hiram-git/payrollsoft.git /home/payrollsoft/app
cd /home/payrollsoft/app
sudo -u payrollsoft git checkout main   # o el tag/rama a desplegar
```

### 6.2. Crear los directorios de storage y logs

```bash
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/lib/payrollsoft
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/lib/payrollsoft/storage
sudo install -d -o payrollsoft -g payrollsoft -m 750 /var/log/payrollsoft
```

### 6.3. Generar el archivo `.env`

Sustituye `payroll.tu-dominio.com` por tu dominio (o, si aún no tienes uno,
por la IP pública — ver nota al final de §9).

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

## 7. Instalar dependencias y compilar

```bash
cd /home/payrollsoft/app
sudo -u payrollsoft -H bun install --frozen-lockfile
sudo -u payrollsoft -H bun run build
```

El build produce:

- `apps/api/dist/index.js` — bundle del API
- `apps/web/dist/server/entry.mjs` + `apps/web/dist/client/` — SSR + assets

> Si el build muere con "Killed" o un error de memoria, casi siempre es OOM:
> revisa que el swap de §3 esté activo (`free -h`).

---

## 8. Migrar la base de datos y crear el super-admin

### 8.1. Migrar el schema central (`public` + `payroll_auth`)

```bash
cd /home/payrollsoft/app
sudo -u payrollsoft -H bun run --filter @payroll/db db:migrate:public
```

### 8.2. Seed inicial (crea el super-admin)

```bash
sudo -u payrollsoft -H bun run --filter @payroll/db db:seed
```

El seed imprime por consola las credenciales del super-admin. **Anótalas**:
son la única forma de entrar a `/superadmin/login` y provisionar empresas.

---

## 9. Servicios systemd

Dos procesos: API + Web. Un unit file para cada uno.

### 9.1. Unit del API

```bash
sudo tee /etc/systemd/system/payrollsoft-api.service >/dev/null <<'UNIT'
[Unit]
Description=PayrollSoft API (Elysia/Bun)
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

### 9.2. Unit del Web

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

### 9.3. Habilitar, arrancar y verificar

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

---

## 10. Nginx como reverse proxy

Como la instancia está limpia, instalamos Nginx desde cero.

```bash
sudo apt install -y nginx
```

Crea `/etc/nginx/sites-available/payrollsoft`:

```bash
sudo tee /etc/nginx/sites-available/payrollsoft >/dev/null <<'NGINX'
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

Activa el sitio y desactiva el default:

```bash
sudo ln -sf /etc/nginx/sites-available/payrollsoft /etc/nginx/sites-enabled/payrollsoft
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

> **Nota CSRF/HTTPS:** PayrollSoft valida el origen vía `X-Forwarded-Proto`.
> El bloque de arriba ya lo envía. Tras montar TLS (§11) ese header pasará a
> `https` automáticamente porque certbot reescribe el `listen` a 443.

> **¿Sin dominio todavía?** Puedes probar apuntando el navegador a
> `http://<IP_PUBLICA>` poniendo esa IP en `server_name _;` y en `WEB_URL` /
> `PUBLIC_API_URL` del `.env` (con `http://`, sin `/api`... usa `http://<IP>/api`).
> Pero para producción **necesitas un dominio** para emitir el certificado TLS
> de §11. Apunta un registro **A** de tu dominio a la IP pública de la instancia.

---

## 11. Certificado TLS con Let's Encrypt

Requiere que el registro **A** de tu dominio ya apunte a la IP pública y que
los puertos 80/443 estén abiertos en **ambos** firewalls (§2).

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d payroll.tu-dominio.com
```

Certbot edita el bloque de Nginx para escuchar en 443, instala el certificado
y configura el redirect 80→443. Verifica la renovación automática:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 12. Primer login

1. Abre `https://payroll.tu-dominio.com/superadmin/login`.
2. Usa las credenciales del super-admin impresas por `db:seed` (§8.2).
3. En el panel de super-admin, **provisiona un tenant** ("empresa") con su
   slug, nombre y el email + password del admin de esa empresa.
4. Cierra sesión, ve a `https://payroll.tu-dominio.com/login` y entra con las
   credenciales del admin del tenant.

> Si la provisión falla con "tenant migrations dir not found", confirma que la
> ruta de `Environment=TENANT_MIGRATIONS_DIR=...` en el unit del API (§9.1)
> existe en disco y es legible por el usuario `payrollsoft`.

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
sudo -u postgres pg_dump -Fc payroll_panama > "$BACKUP_DIR/payroll_panama_${TS}.dump"
find "$BACKUP_DIR" -name 'payroll_panama_*.dump' -mtime +14 -delete
```

```bash
sudo chmod +x /etc/cron.daily/payrollsoft-backup
```

### 13.2. Storage de adjuntos

`STORAGE_DIR` (`/var/lib/payrollsoft/storage`) guarda los adjuntos de
expedientes y, en modo `local_storage`, los PDFs de planillas. Inclúyelo en tu
rotación de backups:

```bash
rsync -aH --delete /var/lib/payrollsoft/storage/ /mnt/backup/payrollsoft-storage/
```

> **Tip Oracle:** considera un **Block Volume** adicional del free tier (hasta
> 200 GB en total) montado en `/mnt/backup`, o subir los dumps a un bucket de
> **OCI Object Storage** (también tiene capa Always Free) con `oci-cli`.

---

## 14. Logs y troubleshooting

```bash
sudo journalctl -u payrollsoft-api -f
sudo journalctl -u payrollsoft-web -f
tail -f /var/log/payrollsoft/api.log /var/log/payrollsoft/web.log
tail -f /var/log/nginx/error.log
```

### Síntomas comunes (incluye los específicos de Oracle)

| Síntoma                                              | Causa probable                                          | Cómo arreglar                                                          |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| La página no carga desde internet, pero `curl` local sí | Falta abrir 80/443 en **uno de los dos** firewalls de OCI | Revisa §2.1 (Security List) **y** §2.2 (iptables local)               |
| `curl` local a `:80` tampoco responde               | Nginx caído o `nginx -t` falla                          | `sudo nginx -t && sudo systemctl status nginx`                        |
| 502 Bad Gateway desde Nginx                         | `payrollsoft-api` o `-web` caído                        | `systemctl status payrollsoft-api payrollsoft-web`                    |
| Login da CSRF / 403                                 | `X-Forwarded-Proto` no llega al backend                 | Verifica el `proxy_set_header X-Forwarded-Proto` en el bloque Nginx   |
| Build muere con "Killed"                            | OOM (instancia con poca RAM)                            | Activa swap (§3)                                                      |
| `❌ Invalid environment variables: JWT_SECRET`      | `JWT_SECRET` con < 32 chars                             | Regenera con `openssl rand -hex 32`                                  |
| `connect ECONNREFUSED 127.0.0.1:5432`               | PostgreSQL no corre / `pg_hba` no permite               | `systemctl status postgresql`                                        |
| Subida de adjunto da "EACCES"                       | `STORAGE_DIR` sin permisos                              | `sudo chown -R payrollsoft:payrollsoft /var/lib/payrollsoft`         |
| `provisionTenant` falla con "migrations not found"  | `TENANT_MIGRATIONS_DIR` mal configurado                 | Ver §9.1 — la ruta debe ser absoluta y legible                       |

---

## 15. Actualizaciones

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

> 💡 Haz el dump de §13.1 **antes** del `db:migrate:all-tenants`.

---

## 16. Checklist final

- [ ] `systemctl is-active payrollsoft-api payrollsoft-web postgresql nginx` → `active` en todos.
- [ ] Reglas 80/443 presentes en la Security List de la VCN **y** en iptables local.
- [ ] `curl -fs https://payroll.tu-dominio.com/api/health` devuelve `status: ok`.
- [ ] Login del super-admin funciona desde el navegador.
- [ ] Primer tenant provisionado y se entra a `/dashboard`.
- [ ] Crear un empleado, generar una planilla, cerrarla y descargar el PDF.
- [ ] Crear un expediente con adjunto y verificar que aparece en
      `/var/lib/payrollsoft/storage/<tenant>_storage/employee_files/`.
- [ ] `certbot renew --dry-run` pasa sin errores.
- [ ] Dump de §13.1 + storage de §13.2 bastan para reconstruir en otra máquina.

---

## Apéndice — Diferencias clave frente a un servidor tradicional

| Tema             | Servidor tradicional (Ubuntu 22.04)        | Oracle Free Tier                                              |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Reverse proxy    | Apache (ya instalado, se reutiliza)        | **Nginx** instalado desde cero (instancia limpia)            |
| Firewall         | Un nivel (`ufw`)                           | **Dos niveles**: Security List de la VCN + iptables local    |
| Arquitectura CPU | Normalmente x86_64                         | Normalmente **ARM aarch64** (Ampere A1) — Bun corre nativo   |
| Memoria          | Suele sobrar                               | Ajustada en Micro → **swap** recomendado/obligatorio         |
| Backups externos | Disco/NAS local                            | **Block Volume** u **Object Storage** del propio free tier   |

Para el detalle de coexistencia con Apache/PHP/MySQL, ver
[`DEPLOYMENT-UBUNTU-22.04.md`](./DEPLOYMENT-UBUNTU-22.04.md).
