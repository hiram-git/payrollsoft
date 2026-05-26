#
# Genera certificados autofirmados para desarrollo local con HTTPS.
#
# Uso (PowerShell):
#   .\scripts\local-https.ps1
#
# Crea .certs\local.key y .certs\local.crt validos para localhost
# y todas las IPs privadas del equipo.
#
# Despues, arranca el dev server con:
#   $env:HTTPS_LOCAL="true"; bun run --filter @payroll/web dev
#
# En la tablet:
#   1. Abre https://<IP-de-tu-PC>:4321/kiosk/setup
#   2. Acepta la advertencia de certificado
#   3. Para evitar la advertencia: copia .certs\local.crt a la tablet
#      e instalalo como CA de confianza

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CertDir = Join-Path $RootDir ".certs"
$Key     = Join-Path $CertDir "local.key"
$Cert    = Join-Path $CertDir "local.crt"

if (!(Test-Path $CertDir)) { New-Item -ItemType Directory -Path $CertDir | Out-Null }

if ((Test-Path $Key) -and (Test-Path $Cert)) {
    Write-Host "Certificados ya existen en $CertDir" -ForegroundColor Green
    Write-Host "  Key:  $Key"
    Write-Host "  Cert: $Cert"
    Write-Host ""
    Write-Host "Para regenerar, borra la carpeta .certs\ y vuelve a ejecutar."
    exit 0
}

# Detectar IPs locales privadas
$LocalIPs = @()
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))' } |
    ForEach-Object { $LocalIPs += $_.IPAddress }

# Construir Subject Alternative Names
$SanEntries = @("DNS:localhost", "IP:127.0.0.1")
foreach ($ip in $LocalIPs) {
    $SanEntries += "IP:$ip"
}
$San = $SanEntries -join ","

Write-Host "Generando certificados para: $San" -ForegroundColor Cyan

# Buscar openssl
$openssl = $null
$candidates = @(
    "openssl",
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files\Git\mingw64\bin\openssl.exe",
    "C:\Program Files (x86)\Git\usr\bin\openssl.exe"
)
foreach ($c in $candidates) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        $openssl = $c
        break
    }
}

if ($openssl) {
    # OpenSSL disponible (viene con Git for Windows)
    $configContent = @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = PayrollSoft Local Dev

[v3_req]
subjectAltName = $San
"@
    $configFile = Join-Path $CertDir "openssl.cnf"
    Set-Content -Path $configFile -Value $configContent -Encoding UTF8

    & $openssl req -x509 -newkey rsa:2048 `
        -keyout $Key `
        -out $Cert `
        -days 365 `
        -nodes `
        -config $configFile 2>$null

    Remove-Item $configFile -ErrorAction SilentlyContinue
}
else {
    # Fallback: usar PowerShell New-SelfSignedCertificate (Windows nativo)
    Write-Host "  openssl no encontrado, usando New-SelfSignedCertificate..." -ForegroundColor Yellow

    $dnsNames = @("localhost")
    $ipAddresses = @([System.Net.IPAddress]::Parse("127.0.0.1"))
    foreach ($ip in $LocalIPs) {
        $ipAddresses += [System.Net.IPAddress]::Parse($ip)
    }

    $cert = New-SelfSignedCertificate `
        -DnsName $dnsNames `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddDays(365) `
        -FriendlyName "PayrollSoft Local Dev" `
        -TextExtension @("2.5.29.17={text}$San")

    # Exportar a PEM
    $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $certBase64 = [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks)
    "-----BEGIN CERTIFICATE-----`n$certBase64`n-----END CERTIFICATE-----" | Set-Content $Cert -Encoding ASCII

    # Exportar clave privada a PEM
    $key = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    $keyBytes = $key.ExportRSAPrivateKey()
    $keyBase64 = [Convert]::ToBase64String($keyBytes, [Base64FormattingOptions]::InsertLineBreaks)
    "-----BEGIN RSA PRIVATE KEY-----`n$keyBase64`n-----END RSA PRIVATE KEY-----" | Set-Content $Key -Encoding ASCII

    # Limpiar del store
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Certificados generados:" -ForegroundColor Green
Write-Host "  Key:  $Key"
Write-Host "  Cert: $Cert"
Write-Host ""
Write-Host "IPs incluidas en el certificado:" -ForegroundColor Cyan
foreach ($ip in $LocalIPs) {
    Write-Host "  https://${ip}:4321"
}
Write-Host "  https://localhost:4321"
Write-Host ""
Write-Host "Para arrancar el dev server con HTTPS:" -ForegroundColor Yellow
Write-Host '  $env:HTTPS_LOCAL="true"; bun run --filter @payroll/web dev'
Write-Host ""
Write-Host "En la tablet, abre:" -ForegroundColor Yellow
foreach ($ip in $LocalIPs) {
    Write-Host "  https://${ip}:4321/kiosk/setup"
}
