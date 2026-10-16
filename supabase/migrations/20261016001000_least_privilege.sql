-- Least privilege: signed-out (anon) callers need no Phase 003 function at all.
-- The two pure status helpers were reachable by anon through Supabase's default grants.
revoke execute on function public.invoice_effective_status(text, date, numeric, text) from anon, public;
revoke execute on function public.quote_effective_status(text, date, text) from anon, public;
grant execute on function public.invoice_effective_status(text, date, numeric, text) to authenticated;
grant execute on function public.quote_effective_status(text, date, text) to authenticated;
