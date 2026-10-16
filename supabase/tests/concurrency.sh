#!/usr/bin/env bash
# Parallel-session numbering test: 30 concurrent connections create quotes and issue
# invoices for the same organisation; numbers must be unique and gapless.
set -euo pipefail
DB=${TEST_DB:-veritaro_test}
OWNER=e3000000-0000-0000-0000-000000000001
ORG=$(psql -tA -d "$DB" -c "select id from public.organisations where name = 'Boland Pest'")
CUST=$(psql -tA -d "$DB" -c "select id from public.customers where organisation_id = '$ORG' and display_name = 'DJ Ossewa'")
AS="set role authenticated; select set_config('request.jwt.claim.sub', '$OWNER', false);"
BEFORE_Q=$(psql -tA -d "$DB" -c "select count(*) from public.quotes where organisation_id = '$ORG'")
BEFORE_I=$(psql -tA -d "$DB" -c "select count(*) from public.invoices where organisation_id = '$ORG' and invoice_number is not null")
for i in $(seq 1 30); do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "$AS
    insert into public.quotes (organisation_id, customer_id, title) values ('$ORG', '$CUST', 'conc $i');
    with inv as (insert into public.invoices (organisation_id, customer_id, title) values ('$ORG', '$CUST', 'conc inv $i') returning id)
    insert into public.invoice_items (organisation_id, invoice_id, description, unit_price) select '$ORG', id, 'x', 10 from inv;
    select public.issue_invoice((select id from public.invoices where title = 'conc inv $i'));" >/dev/null &
done
wait
read -r QN QD <<<"$(psql -tA -F' ' -d "$DB" -c "select count(*), count(distinct quote_number) from public.quotes where organisation_id = '$ORG'")"
read -r IN ID IMAX <<<"$(psql -tA -F' ' -d "$DB" -c "select count(*), count(distinct invoice_number), max(substring(invoice_number from 5)::int) from public.invoices where organisation_id = '$ORG' and invoice_number is not null")"
[ "$QN" -eq $((BEFORE_Q + 30)) ] && [ "$QN" -eq "$QD" ] || { echo "✘ quote numbering not unique under concurrency ($QN/$QD)"; exit 1; }
[ "$IN" -eq $((BEFORE_I + 30)) ] && [ "$IN" -eq "$ID" ] && [ "$IMAX" -eq "$IN" ] || { echo "✘ invoice numbering not unique/gapless ($IN/$ID/$IMAX)"; exit 1; }
echo "  concurrency.sh: 30 parallel sessions → unique quote numbers, gapless INV-0001..INV-$(printf '%04d' "$IMAX")"
