#!/usr/bin/env bash
# Runs migrations + RLS test suite against a throwaway PostgreSQL database.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres ./supabase/tests/run-db-tests.sh
set -euo pipefail
DB=${TEST_DB:-veritaro_test}
DIR="$(cd "$(dirname "$0")/.." && pwd)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/tests/supabase_shim.sql"
for f in "$DIR"/migrations/*.sql; do
  echo "→ applying $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
echo "→ running RLS / tenancy tests"
for t in "$DIR"/tests/*.test.sql; do
  OUT=$(psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1) || { echo "$OUT" | grep -E "ERROR|FAILED" ; echo "✘ database tests FAILED in $(basename "$t")"; exit 1; }
  echo "  $(basename "$t"): $(echo "$OUT" | grep "assertions passed" | tail -1)"
done
TEST_DB="$DB" "$DIR/tests/concurrency.sh"
echo "✔ database tests passed"
