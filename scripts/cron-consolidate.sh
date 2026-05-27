#!/usr/bin/env bash
# ─── Cron script: consolidate attendance + detect absences ───────────────
#
# Calls POST /attendance/consolidate for each active tenant.
# Run daily at 23:59 via crontab:
#
#   59 23 * * * /home/payrollsoft/app/scripts/cron-consolidate.sh >> /var/log/payrollsoft/cron.log 2>&1
#
# Environment variables (set in /home/payrollsoft/app/.env or inline):
#   API_URL       — API base URL (default: http://127.0.0.1:3000)
#   CRON_SECRET   — shared secret for authenticating the cron caller
#                   (optional — if not set, uses the super-admin JWT)
#   SA_EMAIL      — super-admin email for JWT login
#   SA_PASSWORD   — super-admin password for JWT login
#
# The script:
#   1. Logs in as super-admin to get a JWT
#   2. Lists all active tenants
#   3. For each tenant: calls POST /attendance/consolidate with today's date
#   4. Logs results per tenant

set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:3000}"
DATE="${1:-$(date +%Y-%m-%d)}"

echo "$(date '+%Y-%m-%d %H:%M:%S') [cron-consolidate] Starting for date=$DATE"

# Load .env if available
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

SA_EMAIL="${SA_EMAIL:-admin@payrollsoft.com}"
SA_PASSWORD="${SA_PASSWORD:-}"

if [ -z "$SA_PASSWORD" ]; then
  echo "ERROR: SA_PASSWORD not set. Cannot authenticate."
  exit 1
fi

# Login as super-admin
LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SA_EMAIL\",\"password\":\"$SA_PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not get auth token. Login response: $LOGIN_RES"
  exit 1
fi

# List active tenants
TENANTS_RES=$(curl -s "$API_URL/superadmin/tenants" \
  -H "Cookie: auth=$TOKEN")

SLUGS=$(echo "$TENANTS_RES" | grep -o '"slug":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SLUGS" ]; then
  echo "WARNING: No tenants found."
  exit 0
fi

# Consolidate each tenant
SUCCESS=0
FAIL=0

for SLUG in $SLUGS; do
  echo "  [$SLUG] Consolidating $DATE..."

  RESULT=$(curl -s -X POST "$API_URL/attendance/consolidate" \
    -H "Cookie: auth=$TOKEN" \
    -H "X-Tenant: $SLUG" \
    -H "Content-Type: application/json" \
    -d "{\"date\":\"$DATE\"}" \
    --max-time 120)

  PROCESSED=$(echo "$RESULT" | grep -o '"processed":[0-9]*' | cut -d: -f2)
  ABSENT=$(echo "$RESULT" | grep -o '"absent":[0-9]*' | cut -d: -f2)
  ERRORS=$(echo "$RESULT" | grep -o '"errors":\[' | wc -l)

  if echo "$RESULT" | grep -q '"success":true'; then
    echo "  [$SLUG] OK — processed=$PROCESSED absent=$ABSENT"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "  [$SLUG] FAILED — $RESULT"
    FAIL=$((FAIL + 1))
  fi
done

echo "$(date '+%Y-%m-%d %H:%M:%S') [cron-consolidate] Done. success=$SUCCESS fail=$FAIL"
