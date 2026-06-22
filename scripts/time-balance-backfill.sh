#!/usr/bin/env bash
# ─── One-time backfill: open current-year time balances for existing employees ─
#
# Calls POST /time-balance/backfill for each active tenant. Run ONCE after
# deploying the time-balance module so pre-existing active employees get their
# 144h compensatory balance (and family_disability where applicable) for the
# current year, instead of waiting until the next January renewal.
#
# Idempotent: employees that already have the year's balance are skipped.
#
# Usage:  scripts/time-balance-backfill.sh [YEAR]
#
# Environment (set in .env or inline):
#   API_URL     — API base URL (default: http://127.0.0.1:3000)
#   SA_EMAIL    — super-admin email for JWT login
#   SA_PASSWORD — super-admin password for JWT login

set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:3000}"
YEAR="${1:-$(date +%Y)}"

echo "$(date '+%Y-%m-%d %H:%M:%S') [time-balance-backfill] Starting for year=$YEAR"

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

LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SA_EMAIL\",\"password\":\"$SA_PASSWORD\"}")
TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not get auth token. Login response: $LOGIN_RES"
  exit 1
fi

TENANTS_RES=$(curl -s "$API_URL/superadmin/tenants" -H "Cookie: auth=$TOKEN")
SLUGS=$(echo "$TENANTS_RES" | grep -o '"slug":"[^"]*"' | cut -d'"' -f4)
if [ -z "$SLUGS" ]; then
  echo "WARNING: No tenants found."
  exit 0
fi

SUCCESS=0
FAIL=0
for SLUG in $SLUGS; do
  echo "  [$SLUG] Backfilling time balances for $YEAR..."
  RESULT=$(curl -s -X POST "$API_URL/time-balance/backfill" \
    -H "Cookie: auth=$TOKEN" \
    -H "X-Tenant: $SLUG" \
    -H "Content-Type: application/json" \
    -d "{\"year\":$YEAR}" \
    --max-time 300)
  TOTAL=$(echo "$RESULT" | grep -o '"total":[0-9]*' | cut -d: -f2)
  COMP=$(echo "$RESULT" | grep -o '"compensatoryCreated":[0-9]*' | cut -d: -f2)
  if echo "$RESULT" | grep -q '"success":true'; then
    echo "  [$SLUG] OK — total=$TOTAL compensatoryCreated=$COMP"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "  [$SLUG] FAILED — $RESULT"
    FAIL=$((FAIL + 1))
  fi
done

echo "$(date '+%Y-%m-%d %H:%M:%S') [time-balance-backfill] Done. success=$SUCCESS fail=$FAIL"
