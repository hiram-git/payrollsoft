#!/usr/bin/env bash
#
# Setup rápido del módulo de reconocimiento facial.
#
# Ejecuta en orden:
#   1. Genera certs HTTPS locales (si no existen)
#   2. Corre migraciones (public + tenant)
#   3. Verifica que los modelos face-api estén descargados
#   4. Muestra instrucciones para arrancar
#
# Uso:
#   ./scripts/facial-setup.sh
#
# Prerequisitos:
#   - PostgreSQL corriendo con DATABASE_URL en .env
#   - bun instalado

set -euo pipefail
cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════════"
echo "  PayrollSoft — Setup de reconocimiento facial"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── 1. HTTPS local ──────────────────────────────────────────────────
echo "▸ Paso 1: Certificados HTTPS locales"
./scripts/local-https.sh
echo ""

# ─── 2. Migraciones ──────────────────────────────────────────────────
echo "▸ Paso 2: Migraciones de base de datos"
if [ -f .env ]; then
  echo "  Ejecutando migraciones..."
  cd packages/db
  bun --env-file=../../.env src/migrate.ts --public 2>&1 | sed 's/^/  /'
  bun --env-file=../../.env src/migrate.ts --all-tenants 2>&1 | sed 's/^/  /'
  cd ../..
  echo "  ✔ Migraciones aplicadas"
else
  echo "  ⚠ No se encontró .env — salta migraciones."
  echo "    Ejecuta manualmente después:"
  echo "    cd packages/db && bun --env-file=../../.env src/migrate.ts --public"
  echo "    cd packages/db && bun --env-file=../../.env src/migrate.ts --all-tenants"
fi
echo ""

# ─── 3. Modelos face-api ─────────────────────────────────────────────
echo "▸ Paso 3: Modelos face-api"
MODELS_DIR="apps/web/public/face-models"
REQUIRED_FILES=(
  "tiny_face_detector_model-weights_manifest.json"
  "tiny_face_detector_model-shard1"
  "face_landmark_68_model-weights_manifest.json"
  "face_landmark_68_model-shard1"
  "face_recognition_model-weights_manifest.json"
  "face_recognition_model-shard1"
  "face_recognition_model-shard2"
)
MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$MODELS_DIR/$f" ]; then
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -eq 0 ]; then
  echo "  ✔ Todos los modelos presentes"
  ls -lh "$MODELS_DIR"/*.json "$MODELS_DIR"/*shard* 2>/dev/null | awk '{print "  " $5 " " $9}'
else
  echo "  ⚠ Faltan $MISSING archivo(s) de modelo."
  echo "    Descárgalos de: https://github.com/vladmandic/face-api/tree/master/model"
  echo "    O ejecuta:"
  echo ""
  echo "    BASE=https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model"
  echo "    for f in ${REQUIRED_FILES[*]}; do"
  echo "      curl -sL \"\$BASE/\$f\" -o \"$MODELS_DIR/\$f\""
  echo "    done"
  echo ""
fi
echo ""

# ─── 4. Instrucciones ────────────────────────────────────────────────
LOCAL_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))' | head -1 || true)
IP="${LOCAL_IPS:-localhost}"

echo "═══════════════════════════════════════════════════"
echo "  ✔ Setup completo. Para arrancar:"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  # Terminal 1: API"
echo "  bun run --filter @payroll/api dev"
echo ""
echo "  # Terminal 2: Web (HTTP normal)"
echo "  bun run --filter @payroll/web dev"
echo ""
echo "  # Terminal 3: Proxy HTTPS (para tablet)"
echo "  bun scripts/https-proxy.mjs"
echo ""
echo "  # En tu navegador (admin, HTTP normal):"
echo "  http://$IP:4321/facial"
echo ""
echo "  # En la tablet (HTTPS para cámara):"
echo "  https://$IP:4322/kiosk/setup"
echo ""
echo "  Acepta la advertencia de certificado en la tablet."
echo ""
