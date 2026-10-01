-- Allow facilitator to delete their own session
create policy "Facilitator can delete their session"
  on public.sessions for delete
  to anon, authenticated
  using (auth.uid() = facilitator_id);

-- pg_cron is only active on the hosted Supabase platform; the DO block
-- makes this a no-op locally if the extension is unavailable.
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'cleanup-old-sessions',
      '0 * * * *',
      $cron$delete from public.sessions where created_at < now() - interval '24 hours';$cron$
    );
  end if;
end;
$$;
