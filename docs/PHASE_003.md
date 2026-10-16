# Phase 003 — Functional SME Operations MVP

Status: built, tested, migrations applied to hosted Supabase (`zqibpgbbchypqqyopxoh`).

## 1. Lifecycle

```
            Communication (inbox: manual logs, unsent drafts; channels later)
                 │
                 ▼
               LEAD ──────────── convert_lead_to_customer (dup check, links or creates)
                 │                         │
                 ▼                         ▼
            CUSTOMER ◄──────── contacts · sites (Phase 002)
                 │
                 ▼
              QUOTE  draft → sent/viewed → accepted | declined | expired(derived) | archived
                 │   issue_quote snapshots seller/customer/tax; number Q-0001 at create
                 ▼
               JOB   unscheduled ⇄ scheduled → in_progress → completed (| cancelled)
                 │   create_job_from_quote (idempotent, scope from quote); number J-0001
                 ▼
             INVOICE draft → issued → partially_paid → paid  (| void | archived; overdue derived)
                 │   create_invoice_from_job / _from_quote (idempotent); number INV-0001 AT ISSUE
                 ▼
             PAYMENT record_payment (idempotency key, no overpayment) · void_payment (reversal)

   AI assistant · Tasks · Activity log · Follow-up engine · Today — operate across every layer
```

Information entered once flows forward: lead → (customer, contact, site) → quote → job → invoice.
Transactional documents (quotes, invoices) **snapshot** seller, customer, contact, site and tax configuration
when issued; jobs reference canonical records and evolve operationally without changing the quote.

## 2. Migrations

| File | Contents |
|---|---|
| `20261016000200_phase3_foundation.sql` | AI default 5,000 req/month; 16 permissions; field-agent customer access retired; organisation address; `organisation_financial_settings`; `document_sequences` + `next_document_number`; `money()`, `line_amounts()`; `documents` table; private `documents` and `job-photos` buckets + policies |
| `20261016000300_leads_inbox.sql` | `leads`, `conversations`, `conversation_participants`, `messages`, `conversation_reads`; `convert_lead_to_customer`, `log_communication`; message guards (no fake sending) |
| `20261016000400_quotes.sql` | `quotes`, `quote_items`; computed lines/totals; `issue_quote`, `set_quote_outcome`, `duplicate_quote`, `quote_effective_status`, `document_snapshot` |
| `20261016000500_jobs.sql` | `jobs`, `job_assignments`, `job_notes`, `job_photos`; `create_job_from_quote`, `set_job_status`, `find_schedule_conflicts`, `get_field_job`, `list_my_jobs` |
| `20261016000600_invoices_payments.sql` | `invoices`, `invoice_items`, `payments`; `create_invoice_from_job/_quote`, `issue_invoice`, `void_invoice`, `archive_invoice`, `record_payment`, `void_payment`, `customer_balance`, `invoice_effective_status` |
| `20261016000700_today_search.sql` | `today_summary(org)` (permission-sectioned), `global_search(org, q, limit)` |
| `20261016000800_phase3_hardening.sql` | Review fixes: manual draft replies; conversation link FKs; bank details hidden from field agents; issuing an old draft keeps its terms; idempotency key bound to one invoice; reopen blocked when invoiced via quote; search returns effective statuses; `jobs.internal_notes` not API-readable (office reads via `get_job_internal_notes`) |

All Phase 003 migrations are additive (`create or replace`, `alter policy`, grants) — no DROP/DELETE.

## 3. Money and tax

- `numeric(14,2)` everywhere; never floats. Totals are computed by triggers (`quote_item_compute`, `refresh_quote_totals`,
  invoice equivalents). Clients cannot write totals (guarded by session flags only the definer RPCs set).
- Per-line VAT (approved): `gross = round(qty × price)`, discount (% or fixed, capped), `tax = round(net × rate/100)`
  (or `net × rate/(100+rate)` when the document's *prices include VAT* toggle is on). Document: subtotal = Σ excl,
  VAT = Σ tax, total = subtotal + VAT (DB constraint).
- Non-VAT businesses: rate 0 regardless of line flags. Rate/label/registration are snapshotted when issued; changing
  settings later never alters issued documents. Drafts follow the current settings.
- `src/lib/money-calc.ts` mirrors `line_amounts()` exactly with BigInt rationals for live previews; a 400-case
  randomised TS↔SQL parity check runs with the DB tests.
- The AI never computes money: tools pass user-stated amounts as decimal strings; replies quote DB-computed totals.

## 4. Numbering

`document_sequences(organisation_id, doc_type, prefix, pad, next_value)` with a row-locked `UPDATE … RETURNING`
(`app_private.next_document_number`). Quotes `Q-0001` and jobs `J-0001` are numbered on insert; invoices are numbered
**on issue** so the issued sequence has no gaps from abandoned drafts. Concurrency test: 30 parallel sessions →
unique quote numbers and gapless invoice numbers. Prefix/pad are configurable per organisation (DB-ready).

## 5. State machines (enforced in Postgres)

- Quote: transitions only via `issue_quote` / `set_quote_outcome`; issued quotes are frozen (lines + header);
  revisions via `duplicate_quote`. Expired is derived (`quote_effective_status`) and an expired quote can't be accepted.
  Accepting wins the linked lead. `issue_quote(method)`: `manual` / `download`; `channel` raises "No messaging channel is connected yet".
- Job: status derived from schedule (unscheduled ⇄ scheduled); start/complete/cancel/reopen only via `set_job_status`.
  A quote-linked job requires an accepted quote; one active job per quote. Reopen is blocked once invoiced.
  "Invoiced" is a display state (completed + non-void invoice), not a stored status.
- Invoice: drafts editable; `issue_invoice` snapshots (incl. bank details), assigns the number, total must be > 0.
  Payments drive `partially_paid` / `paid`; overdue is derived. Void only without live payments; never hard-deleted.
- Payment: immutable; reversal via `void_payment` (reason required). Overpayment rejected. `idempotency_key`
  unique per organisation and bound to one invoice.

## 6. Permissions (46 total; +16 in Phase 003)

| Role | Phase 003 grants |
|---|---|
| owner, admin | all |
| accountant | leads.read, inbox.read, quotes.read/write/issue, jobs.read_all, invoices.read/write/issue, payments.read/record |
| supervisor | leads.*, inbox.*, quotes.*, jobs.read_all/write/work |
| field_agent | jobs.read_assigned, jobs.work |
| viewer | every `.read` |

Field agents: `customers.read_linked` is retired. They cannot select customers, contacts, sites, quotes, invoices,
payments, leads, conversations or bank settings. Job customer/site/contact/scope comes only from `get_field_job` /
`list_my_jobs` for jobs assigned to them. `jobs.internal_notes` is not column-readable via the API at all.

## 7. Storage

Private buckets, no public URLs, paths always `{organisation_id}/…` (policies check the first segment):
- `documents` (PDF, 10 MB): `{org}/quotes/{quote_id}/{Q-0001}.pdf`, `{org}/invoices/{invoice_id}/{INV-0001}.pdf`.
  Read needs quotes.read / invoices.read; write needs quotes.issue / invoices.issue; no update/delete (immutable).
  A `documents` row (sha256, size, version) registers each stored file.
- `job-photos` (jpeg/png/webp, 8 MB): `{org}/jobs/{job_id}/{uuid}.jpg`, readable/writable by users who can access the
  job (office or assigned field agent). Client resizes to ≤1600 px JPEG ~0.8 before upload (strips EXIF). Signed URLs (5 min).

## 8. PDFs

`@react-pdf/renderer`, server route handlers (Node runtime) `/api/documents/{quotes|invoices}/{id}/pdf[?download=1]`
using the user's Supabase client (RLS applies; 404 when not visible). One professional A4 template for both.
Issued documents render strictly from snapshot columns; drafts render live data with a DRAFT label. The first request
for an issued document stores the PDF; later requests stream the stored file. Invoices with payments or voided render
fresh from the same snapshots (shows paid/due or VOID). Service-role key is never used.

## 9. Follow-up engine (deterministic, no AI)

Configurable in Settings → Quotes & invoices: lead follow-up days (2), quote follow-up days (3), invoice due-soon days (3).
- Lead: `next_follow_up_at` due today/past, or no activity for N days (open statuses).
- Quote: sent/viewed, not expired, issued more than N days ago; expiring within 3 days.
- Invoice: due soon, overdue (unpaid past due date).
- Jobs: today, in progress, unassigned in the next 7 days, unscheduled, completed but not invoiced.
- Tasks: overdue, due today. Inbox: conversations needing attention.
`today_summary(org)` returns only the sections the caller may see. Today turns these into prioritised, clickable
attention items; the optional AI briefing receives only pre-formatted item headlines (no ids, emails or phones), and
any number in the AI text that wasn't in the input is rejected.

## 10. AI tools (Phase 003 additions)

READ: find_leads, get_lead, list_leads_needing_followup, find_quotes, get_quote, list_quotes_needing_followup, find_jobs,
list_jobs_for_date, list_team_members, find_invoices, get_invoice, get_customer_balance, list_unpaid_invoices,
list_overdue_invoices, get_today_summary, get_conversation.
DRAFT: create_lead, update_lead_status, convert_lead_to_customer, create_quote_draft, add_quote_line, create_job_from_quote,
schedule_job, assign_job, start_job, create_invoice_from_job, create_invoice_from_quote, log_communication, draft_reply.
CONSEQUENTIAL (explicit confirmation of the exact input; atomic claim so a double click runs once): mark_quote_sent,
accept_quote, decline_quote, complete_job, issue_invoice, void_invoice, record_payment, send_message (+ archive_customer).
`send_message` is refused *before* confirmation: no channel is connected.

Context: screen context now covers customer, lead, quote, job and invoice pages (re-verified via RLS). Each saved
assistant turn carries a "Records referenced" footer (data, not instructions) that rolls forward, so "that quote",
"the job", "invoice them" resolve beyond the 6-message history window. Ambiguity rule: if several records match, the
assistant asks "Which one do you mean?" with safe identifying details; payments with several unpaid invoices ask first.

## 11. Screens

Sales: `/app/sales/leads` (pipeline board + list, Move-to menu, drag/drop enhancement, mobile list), `/app/sales/leads/[id]`,
`/app/sales/quotes`, `/app/sales/quotes/new`, `/app/sales/quotes/[id]` (builder / issued view), customer detail Quotes/Jobs/Invoices tabs + balance.
Inbox: `/app/inbox` (two-pane, filters All/Unread/Needs attention/WhatsApp/Email/Leads, honest empty states, log communication, unsent drafts).
Work: `/app/work/jobs`, `/app/work/jobs/new?quote=`, `/app/work/jobs/[id]` (office tabs or field mobile view), `/app/work/calendar` (month + day, conflicts, unscheduled list).
Money: `/app/money` (overview), `/app/money/invoices`, `/app/money/invoices/[id]`, `/app/money/payments`.
Settings: `/app/settings/financial`. Today rebuilt as an action centre. Cmd/Ctrl+K global search.
Quick create: Lead, Customer, Quote, Job, Invoice, Payment, Task (+ mobile: Ask AI, Job photo).

## 12. Known limitations

- No email/WhatsApp provider: "send" = download PDF / mark as sent manually; inbound messages only via future integrations.
- No public quote acceptance or customer portal (architecture allows it later via a signed-token RPC).
- Draft saves are several statements (retry-safe, totals always consistent) rather than one RPC transaction.
- Organisation logo is fetched at PDF render, not snapshotted.
- Quote numbering hardcodes the default timezone in `issue_quote`/`duplicate_quote` date defaults (org timezone used elsewhere).
- The "prices include VAT" settings default for new quotes/invoices is applied in the app layer (the DB column default shadows the guard).
- Orphaned photo files possible if the row insert fails after upload (no client delete); needs a cleanup job.
- Assistant rate limit (30 model calls / user / 10 min) counts model calls; a long multi-step AI session can hit it.
- Job photo upload not exercised in local E2E (no Storage API locally); covered by SQL storage-policy tests.
- Double-entry accounting is not implemented; invoices/payments are designed to post to a future ledger (immutable
  issued documents, payments as separate immutable rows, voids instead of deletes).
