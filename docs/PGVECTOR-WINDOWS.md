# Instalar pgvector en Windows (PostgreSQL nativo)

> El módulo de **reconocimiento facial** de PayrollSoft requiere la
> extensión [`pgvector`](https://github.com/pgvector/pgvector) para
> almacenar embeddings 128-d. Esta guía cubre cómo instalarla cuando
> tu PostgreSQL corre en Windows nativo (no en WSL ni Docker).
>
> **Si no piensas usar reconocimiento facial**, puedes saltarte esta
> guía: la migración `0034_facial_recognition` detecta automáticamente
> la ausencia de pgvector y deja el módulo deshabilitado sin romper
> el resto del sistema (planilla, vacaciones, expedientes, tesorería
> y demás funcionan normalmente).

---

## Opciones disponibles

| Opción | Cuándo conviene | Complejidad |
| --- | --- | --- |
| **A. Docker Desktop con imagen `pgvector/pgvector`** | Entorno de pruebas / dev | Muy baja |
| **B. WSL2 con PostgreSQL + pgvector** | Dev local pero quieres Linux real | Baja |
| **C. PostgreSQL nativo Windows + binarios pre-compilados** | Producción Windows-only | Media |
| **D. PostgreSQL nativo Windows + compilar pgvector con MSVC** | Producción con versión exacta | Alta |

Para un **entorno de pruebas** la opción más rápida es **A (Docker)**.
Para **producción Windows-only** la C suele ser suficiente.

---

## Opción A — Docker Desktop

La imagen oficial `pgvector/pgvector` viene con la extensión
pre-instalada y lista para usarse.

### A.1. Pre-requisitos

- Docker Desktop instalado y corriendo en Windows.
- Puerto `5432` libre (si tienes PostgreSQL nativo ya en ese puerto,
  detén el servicio en `services.msc` o usa otro puerto para Docker).

### A.2. Levantar el contenedor

```powershell
# PowerShell
docker run -d `
  --name payrollsoft-pg `
  -e POSTGRES_USER=payrollsoft `
  -e POSTGRES_PASSWORD=CAMBIA_ESTA_CLAVE `
  -e POSTGRES_DB=payroll_panama `
  -p 5432:5432 `
  -v payrollsoft_data:/var/lib/postgresql/data `
  pgvector/pgvector:pg16
```

### A.3. Verificar

```powershell
docker exec -it payrollsoft-pg psql -U payrollsoft -d payroll_panama -c "CREATE EXTENSION vector; SELECT extversion FROM pg_extension WHERE extname='vector';"
```

Esperas ver el número de versión (`0.7.x` o superior).

### A.4. Configurar `.env` de PayrollSoft

```env
DATABASE_URL=postgresql://payrollsoft:CAMBIA_ESTA_CLAVE@localhost:5432/payroll_panama
```

Y ya: cuando corras las migraciones, `pgvector` ya está disponible.

---

## Opción B — WSL2 con PostgreSQL + pgvector

Si prefieres Linux real bajo Windows:

### B.1. Instalar WSL2 + Ubuntu

```powershell
wsl --install -d Ubuntu-22.04
```

### B.2. Dentro de Ubuntu (WSL)

```bash
sudo apt update
sudo apt install -y postgresql-16 postgresql-16-pgvector
sudo systemctl enable --now postgresql
```

### B.3. Configurar PostgreSQL para acceso desde Windows

Edita `/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = '*'
```

Edita `/etc/postgresql/16/main/pg_hba.conf` y agrega:

```
host    all    all    127.0.0.1/32    scram-sha-256
host    all    all    172.16.0.0/12   scram-sha-256
```

Reinicia: `sudo systemctl restart postgresql`.

Desde Windows, conectas a `localhost:5432` igual que con Docker.

---

## Opción C — PostgreSQL nativo Windows + binarios pre-compilados

Si ya tienes PostgreSQL instalado en Windows (típicamente vía
[EnterpriseDB installer](https://www.postgresql.org/download/windows/)),
necesitas agregar la extensión copiando tres archivos a las carpetas
correctas.

### C.1. Identifica tu instalación

Abre **pgAdmin** o ejecuta en `psql`:

```sql
SHOW server_version;
SHOW config_file;
```

Anota dos cosas:
- **Versión mayor**: ej. `16` (los binarios deben coincidir con esta
  versión — pgvector compilado para PG 15 NO funciona en PG 16).
- **Carpeta de instalación**: típicamente `C:\Program Files\PostgreSQL\16\`.

### C.2. Descargar binarios

Hay dos fuentes confiables de DLLs pre-compiladas para Windows:

1. **[pgvector releases oficiales](https://github.com/pgvector/pgvector/releases)** — los assets con `windows-x64.zip` traen los binarios.
2. **[pgvector-windows-installer](https://github.com/foxweb/pgvector-windows-installer)** — comunidad, instalador interactivo.

Descarga el `.zip` que coincida con tu versión de PostgreSQL.

### C.3. Copiar archivos (PowerShell como Administrador)

Dentro del `.zip` encuentras estos archivos. Cópialos a las rutas
indicadas (ajusta `16` a tu versión):

```powershell
# Detén el servicio PostgreSQL primero
Stop-Service postgresql-x64-16

$PG = "C:\Program Files\PostgreSQL\16"

# 1. La DLL (extensión binaria)
Copy-Item ".\vector.dll" "$PG\lib\"

# 2. Archivo de control (descripción de la extensión)
Copy-Item ".\vector.control" "$PG\share\extension\"

# 3. Scripts SQL (definiciones de la extensión)
Copy-Item ".\vector--*.sql" "$PG\share\extension\"

# Reinicia el servicio
Start-Service postgresql-x64-16
```

### C.4. Verificar disponibilidad

```sql
-- En psql o pgAdmin, conectado a payroll_panama:
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```

Debes ver una fila con el nombre `vector` y la versión disponible.

### C.5. Re-correr la migración del módulo facial

Si **ya provisionaste tenants antes** de instalar pgvector, la
migración 0034 corrió como no-op. Para activarla retroactivamente:

```sql
-- Conéctate a payroll_panama con un usuario con privilegios:
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
```

Después, desde tu carpeta del proyecto en PowerShell:

```powershell
bun run --filter @payroll/db db:migrate:all-tenants
```

Tenants nuevos provisionados *después* de instalar pgvector tendrán
las tablas facial automáticamente sin pasos extra.

---

## Opción D — Compilar pgvector con Visual Studio

Solo recomendada si necesitas una versión específica que no está en
los releases pre-compilados, o si tu PostgreSQL es un build custom.

### D.1. Pre-requisitos

- **Visual Studio 2022** con la carga de trabajo "Desarrollo para el
  escritorio con C++" instalada.
- **PostgreSQL** instalado con sus archivos `include` y `lib` (el
  installer estándar los incluye).
- **Git for Windows**.

### D.2. Clonar y compilar

Abre **"x64 Native Tools Command Prompt for VS 2022"** (no PowerShell
ni `cmd.exe` normal — el `nmake` necesita el entorno de MSVC).

```cmd
set "PGROOT=C:\Program Files\PostgreSQL\16"
git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git
cd pgvector
nmake /F Makefile.win
nmake /F Makefile.win install
```

`nmake install` deja los tres archivos (`vector.dll`,
`vector.control`, `vector--*.sql`) en las carpetas correctas
automáticamente.

### D.3. Reiniciar servicio + verificar

```powershell
Restart-Service postgresql-x64-16
```

Y sigue con §C.4 y §C.5 para verificar y activar el módulo facial.

---

## Diagnóstico rápido

```sql
-- ¿Está la extensión disponible? (instalada en el servidor)
SELECT name, default_version, installed_version
  FROM pg_available_extensions
 WHERE name = 'vector';

-- ¿Está la extensión activada en esta base?
SELECT extname, extversion
  FROM pg_extension
 WHERE extname = 'vector';

-- ¿Cuántos tenants ya tienen las tablas facial creadas?
SELECT count(DISTINCT table_schema)
  FROM information_schema.tables
 WHERE table_name = 'facial_enrollments';
```

| Resultado | Interpretación |
| --- | --- |
| `pg_available_extensions` vacío | pgvector NO está instalado a nivel servidor. Vuelve a §C.3 o usa otra opción. |
| `pg_available_extensions` poblado pero `pg_extension` vacío | La extensión está disponible pero no está creada en la base. Ejecuta `CREATE EXTENSION vector;` conectado a `payroll_panama`. |
| Ambas pobladas, pero `facial_enrollments` no existe en algunos tenants | Esos tenants se provisionaron antes de instalar pgvector. Sigue §C.5 para re-correr la migración. |

---

## Síntomas comunes

| Mensaje | Causa | Solución |
| --- | --- | --- |
| `extension "vector" is not available` | La DLL no está en el `lib/` correcto, o la versión no coincide con la del servidor. | Verifica con `SELECT version();` que la versión binaria coincide con la versión del servidor (16.x con 16.x). |
| `could not load library "vector"` | La DLL está mal copiada o sin permisos. | Re-copiar como administrador, reiniciar el servicio. |
| `cannot determine encoding of file` | Encoding del SQL incorrecto (UTF-8 BOM). | Re-descargar los scripts `vector--*.sql` desde el release oficial. |
| Migración 0034 hace `RETURN` con NOTICE | pgvector no disponible — comportamiento esperado. | Si quieres habilitar facial, instala pgvector y sigue §C.5. |

---

## Notas adicionales

- **No mezcles arquitecturas**: el PostgreSQL típico de Windows es
  x64. Asegúrate de que los binarios de pgvector también sean
  `windows-x64`, no `x86`.
- **Una sola copia por base**: PostgreSQL permite una sola copia de
  `vector` por base. Las migraciones tenant-scoped no la re-crean
  (usan `CREATE EXTENSION IF NOT EXISTS`).
- **Backup antes de re-correr migraciones**: aunque la migración 0034
  es idempotente (`CREATE TABLE IF NOT EXISTS`), siempre haz un
  `pg_dump` previo. En PowerShell:
  ```powershell
  & "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U payrollsoft -d payroll_panama -F c -f payroll_backup.dump
  ```
