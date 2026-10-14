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
OUT=$(psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/tests/rls.test.sql" 2>&1) || { echo "$OUT" | grep -E "ERROR|FAILED" ; echo "✘ database tests FAILED"; exit 1; }
echo "$OUT" | grep "assertions passed"
echo "✔ database tests passed"
