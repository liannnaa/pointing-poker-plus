-- Sprint teammates: the host's roster of people working the next sprint, plus
-- per-ticket assignment so the plan can be balanced per person rather than only
-- against a single team-wide capacity target.
--
-- Teammates are real Jira users, keyed by accountId. As with sprint_plan_items,
-- reads are open (everyone in the room sees the plan) and only the session's
-- facilitator may mutate.

create table public.sprint_teammates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  -- Jira accountId. GDPR-strict sites omit email, so this is the only stable key.
  account_id text not null,
  display_name text not null,
  email text,
  avatar_url text,
  -- Per-person bandwidth target in story points. Null = no individual target.
  capacity_points numeric,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, account_id)
);

create index sprint_teammates_session_idx on public.sprint_teammates (session_id);

-- Deliberately a plain text column, not a foreign key: removing a teammate must
-- leave their tickets in the plan as unassigned, never cascade-delete them.
alter table public.sprint_plan_items add column assignee_account_id text;

alter table public.sprint_teammates enable row level security;

create policy "Anyone can read sprint teammates"
  on public.sprint_teammates for select
  to anon, authenticated
  using (true);

create policy "Facilitator can insert sprint teammates"
  on public.sprint_teammates for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = sprint_teammates.session_id
        and s.facilitator_id = auth.uid()
    )
  );

create policy "Facilitator can update sprint teammates"
  on public.sprint_teammates for update
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = sprint_teammates.session_id
        and s.facilitator_id = auth.uid()
    )
  );

create policy "Facilitator can delete sprint teammates"
  on public.sprint_teammates for delete
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = sprint_teammates.session_id
        and s.facilitator_id = auth.uid()
    )
  );
