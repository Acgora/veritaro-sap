#!/usr/bin/env bash
# Compare a LIVE database's security configuration with the reviewed baseline.
# Usage: SUPABASE_DB_URL='postgresql://…' scripts/security-drift.sh   (read-only; exits 1 on drift)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the database connection string (never commit it)}"
if diff -u "$DIR/supabase/security-baseline.txt" <(psql "$SUPABASE_DB_URL" -q -At -f "$DIR/scripts/security-baseline.sql"); then
  echo "✔ no security drift: live database matches supabase/security-baseline.txt"
else
  echo "✘ SECURITY DRIFT: live database differs from the reviewed baseline (see diff above)"; exit 1
fi
