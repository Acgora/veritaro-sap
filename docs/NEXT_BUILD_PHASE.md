# Next build phase (after Phase 003)

Phase 003 is complete; Phase 004 has NOT been started. Candidate scope, to be specified by the product owner:

- Messaging integrations (email provider, WhatsApp Business) feeding `messages` via a service-role ingestion path; real "send" for quotes/invoices.
- Public quote acceptance with signed, expiring tokens (no customer login), recorded as accepted_method = 'signed'.
- Double-entry ledger: post issued invoices, payments and voids from the existing immutable records.
- Expenses with receipt capture (job costs tab is a placeholder today).
- Atomic `save_quote_draft` / `save_invoice_draft` RPCs; logo snapshot on issue; org timezone in `issue_quote`.
- Storage cleanup job for orphaned photo uploads.
- Review the assistant rate limit (counts model calls, not user messages).
