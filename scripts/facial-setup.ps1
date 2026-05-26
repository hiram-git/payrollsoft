#
# Setup rapido del modulo de reconocimiento facial (Windows).
#
# Ejecuta en orden:
#   1. Genera certs HTTPS locales
#   2. Corre migraciones (public + tenant)
#   3. Verifica modelos face-api
#   4. Muestra instrucciones
#
# Uso:
#   .\scripts\facial-setup.ps1
#
# Prerequisitos:
#   - PostgreSQL corriendo con DATABASE_URL en .env
#   - bun instalado

$ErrorActionPreference = "Stop"

function Format-FileSize([long]$size) {
    if ($size -ge 1MB) { return "{0:N1} MB" -f ($size / 1MB) }
    if ($size -ge 1KB) { return "{0:N0} KB" -f ($size / 1KB) }
    return "$size B"
}

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $RootDir

try {

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  PayrollSoft - Setup de reconocimiento facial" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. HTTPS local ---
Write-Host ">> Paso 1: Certificados HTTPS locales" -ForegroundColor White
& .\scripts\local-https.ps1
Write-Host ""

# --- 2. Migraciones ---
Write-Host ">> Paso 2: Migraciones de base de datos" -ForegroundColor White
$envFile = Join-Path $RootDir ".env"
if (Test-Path $envFile) {
    Write-Host "  Ejecutando migraciones..."
    Push-Location (Join-Path $RootDir "packages\db")
    try {
        bun --env-file=../../.env src/migrate.ts --public 2>&1 | ForEach-Object { "  $_" }
        bun --env-file=../../.env src/migrate.ts --all-tenants 2>&1 | ForEach-Object { "  $_" }
        Write-Host "  OK Migraciones aplicadas" -ForegroundColor Green
    }
    finally { Pop-Location }
}
else {
    Write-Host "  AVISO: No se encontro .env - se saltan migraciones." -ForegroundColor Yellow
    Write-Host "  Ejecuta manualmente despues:"
    Write-Host "    cd packages\db; bun --env-file=../../.env src/migrate.ts --public"
    Write-Host "    cd packages\db; bun --env-file=../../.env src/migrate.ts --all-tenants"
}
Write-Host ""

# --- 3. Modelos face-api ---
Write-Host ">> Paso 3: Modelos face-api" -ForegroundColor White
$ModelsDir = Join-Path $RootDir "apps\web\public\face-models"
$RequiredFiles = @(
    "tiny_face_detector_model-weights_manifest.json",
    "tiny_face_detector_model.bin",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model.bin",
    "face_recognition_model-weights_manifest.json",
    "face_recognition_model.bin"
)

$missing = 0
foreach ($f in $RequiredFiles) {
    if (!(Test-Path (Join-Path $ModelsDir $f))) { $missing++ }
}

if ($missing -eq 0) {
    Write-Host "  OK Todos los modelos presentes" -ForegroundColor Green
    Get-ChildItem $ModelsDir -Include "*.json","*.bin" -Recurse |
        ForEach-Object { Write-Host ("  {0,8} {1}" -f (Format-FileSize $_.Length), $_.Name) }
}
else {
    Write-Host "  AVISO: Faltan $missing archivo(s) de modelo." -ForegroundColor Yellow
    Write-Host "  Descargalos ejecutando:"
    Write-Host ""
    Write-Host '  $base = "https://raw.githubusercontent.com/vladmandic/face-api/master/model"' -ForegroundColor Gray
    foreach ($f in $RequiredFiles) {
        Write-Host "  Invoke-WebRequest `"`$base/$f`" -OutFile `"$ModelsDir\$f`"" -ForegroundColor Gray
    }
    Write-Host ""
}
Write-Host ""

# --- 4. Instrucciones ---
$LocalIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))' } |
    Select-Object -First 1).IPAddress
if (!$LocalIP) { $LocalIP = "localhost" }

Write-Host "======================================================" -ForegroundColor Green
Write-Host "  OK Setup completo. Para arrancar:" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  # Terminal 1: API" -ForegroundColor Yellow
Write-Host "  bun run --filter @payroll/api dev"
Write-Host ""
Write-Host "  # Terminal 2: Web con HTTPS" -ForegroundColor Yellow
Write-Host '  $env:HTTPS_LOCAL="true"; bun run --filter @payroll/web dev'
Write-Host ""
Write-Host "  # En tu navegador (admin):" -ForegroundColor Yellow
Write-Host "  https://${LocalIP}:4321/facial"
Write-Host ""
Write-Host "  # En la tablet (kiosko):" -ForegroundColor Yellow
Write-Host "  https://${LocalIP}:4321/kiosk/setup"
Write-Host ""
Write-Host "  Acepta la advertencia de certificado en el navegador."
Write-Host ""

}
finally { Pop-Location }
