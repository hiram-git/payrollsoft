#!/usr/bin/env bash
#
# Genera certificados autofirmados para desarrollo local con HTTPS.
#
# Uso:
#   ./scripts/local-https.sh
#
# Esto crea .certs/local.key y .certs/local.crt válidos para:
#   - localhost
#   - 127.0.0.1
#   - Todas las IPs privadas del equipo (192.168.*, 10.*, etc.)
#
# Después, arranca el dev server con:
#   HTTPS_LOCAL=true bun run --filter @payroll/web dev
#
# En la tablet:
#   1. Abre https://<IP-de-tu-PC>:4321/kiosk/setup
#   2. El navegador mostrará advertencia de certificado — acepta y continúa
#   3. En Android: chrome://flags → "Allow invalid certificates for
#      resources loaded from localhost" → Enabled
#   4. Alternativa más limpia: copia .certs/local.crt a la tablet e
#      instálalo como CA de confianza (Settings → Security → Install cert)

set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/.certs"
mkdir -p "$CERT_DIR"

KEY="$CERT_DIR/local.key"
CERT="$CERT_DIR/local.crt"

if [ -f "$KEY" ] && [ -f "$CERT" ]; then
  echo "Certificados ya existen en $CERT_DIR"
  echo "  Key:  $KEY"
  echo "  Cert: $CERT"
  echo ""
  echo "Para regenerar, borra la carpeta .certs/ y vuelve a ejecutar."
  exit 0
fi

# Detectar IPs locales del equipo
LOCAL_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))' || true)

# Construir Subject Alternative Names
SAN="DNS:localhost,IP:127.0.0.1"
for ip in $LOCAL_IPS; do
  SAN="$SAN,IP:$ip"
done

echo "Generando certificados para: $SAN"

openssl req -x509 -newkey rsa:2048 \
  -keyout "$KEY" \
  -out "$CERT" \
  -days 365 \
  -nodes \
  -subj "/CN=PayrollSoft Local Dev" \
  -addext "subjectAltName=$SAN" \
  2>/dev/null

echo ""
echo "Certificados generados:"
echo "  Key:  $KEY"
echo "  Cert: $CERT"
echo ""
echo "IPs incluidas en el certificado:"
for ip in $LOCAL_IPS; do
  echo "  https://$ip:4321"
done
echo "  https://localhost:4321"
echo ""
echo "Para arrancar el dev server con HTTPS:"
echo "  HTTPS_LOCAL=true bun run --filter @payroll/web dev"
echo ""
echo "En la tablet, abre:"
for ip in $LOCAL_IPS; do
  echo "  https://$ip:4321/kiosk/setup"
done
