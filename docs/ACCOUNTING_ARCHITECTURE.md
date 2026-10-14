# Accounting architecture — constraints for future phases

Veritaro will **replace** accounting software, not integrate with it. Invoicing is therefore not CRUD; it is a document that produces ledger entries. Nothing below is built in Phase 001; these rules are binding when Money ships.

## Non-negotiables

1. **Double entry.** `journal_entries(id, organisation_id, date, source_type, source_id, status draft|posted|reversed, posted_at, posted_by)` + `journal_lines(entry_id, account_id, debit numeric(19,4), credit numeric(19,4), tax_code_id, …)`. A DB constraint/trigger enforces Σdebit = Σcredit per entry at posting time; one of debit/credit is zero per line.
2. **Posted is immutable.** No UPDATE/DELETE on posted entries or lines (trigger-enforced, like `activity_log`). Corrections are reversing entries + new entries. Credit notes, not edited invoices.
3. **Money types.** `numeric(19,4)` in the DB; decimal **strings** across the API; arithmetic in Postgres or integer minor units. `src/lib/money.ts` only formats.
4. **Currency.** `organisations.currency` is the functional currency; lock it once any financial record exists. Foreign-currency documents store `currency`, `exchange_rate numeric(19,8)`, and base-currency amounts.
5. **Tax/VAT as data.** `tax_rates(organisation_id, code, rate numeric(7,4), effective_from, effective_to, …)` — never hard-code 15%. Line-level tax amounts stored, not re-derived later. Support VAT-registered and non-registered orgs, inclusive/exclusive pricing.
6. **Chart of accounts per organisation** (`accounts(organisation_id, code, name, type asset|liability|equity|income|expense, system_key)`), seeded from a country template. System accounts (debtors, creditors, VAT output/input, bank) referenced by `system_key`, not by name.
7. **Periods.** `financial_year_end_month` exists now. Add `accounting_periods` with lock dates; posting into a locked period is rejected by the DB.
8. **Sub-ledgers reconcile to the GL.** Invoices/payments/bank transactions link to journal entries (`journal_entries.source_type/source_id`, plus FKs from documents to their entry). Customer balance = sum of AR lines, not a stored number that can drift.
9. **Numbering.** Gapless per-org sequences for invoices/credit notes (`document_sequences` row locked `FOR UPDATE`), assigned at finalisation, not draft.
10. **Audit.** Every post/reverse writes `activity_log` with `actor_type`; AI may only create *drafts* (DRAFT class). Posting, sending and reversing are CONSEQUENTIAL.
11. **Owner-facing simplicity.** "Record expense R450 incl. VAT" in the UI becomes a correct multi-line journal behind the scenes. The simplified UI never bypasses the engine.

## Lifecycle linkage

`leads → customers → quotes(customer_id) → jobs(quote_id) → invoices(job_id, customer_id) → payments → journal_entries`. Each stage copies **by reference** (FK) and snapshots only what must be legally frozen (e.g. invoice line descriptions, prices and tax at issue time).
