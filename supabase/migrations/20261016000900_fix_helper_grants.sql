-- Hosted Supabase does not auto-grant EXECUTE on app_private functions (the local shim did, which
-- hid this). Two helpers are called from SECURITY INVOKER code paths and need explicit grants:
--   next_document_number      ← guard_quotes / guard_jobs (numbering on insert). Has its own
--                               permission check; app_private is not exposed through the API.
--   copy_quote_items_to_invoice ← create_invoice_from_job / _from_quote (runs under RLS).
-- Symptom: creating any quote or job failed with "permission denied for function next_document_number".
grant execute on function app_private.next_document_number(uuid, text) to authenticated;
grant execute on function app_private.copy_quote_items_to_invoice(uuid, uuid) to authenticated;
