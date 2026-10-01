-- Sprint planning: a facilitator-curated set of tickets destined for the next
-- sprint, with a running point total measured against a team capacity target.
--
-- The plan is broadcast to every participant, so reads are open; only the
-- session's facilitator may mutate it.

create table public.sprint_plan_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  issue_key text not null,
  summary text not null,
  -- null means the ticket has no story points in Jira yet
  points numeric,
  position integer not null default 0,
  added_by uuid not null,
  created_at timestamptz not null default now(),
  unique (session_id, issue_key)
);

create index sprint_plan_items_session_idx on public.sprint_plan_items (session_id);

-- Team bandwidth target for the session, in story points. Null = no target set.
alter table public.sessions add column capacity_points numeric;

alter table public.sprint_plan_items enable row level security;

create policy "Anyone can read sprint plan items"
  on public.sprint_plan_items for select
  to anon, authenticated
  using (true);

create policy "Facilitator can insert sprint plan items"
  on public.sprint_plan_items for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = sprint_plan_items.session_id
        and s.facilitator_id = auth.uid()
    )
  );

create policy "Facilitator can update sprint plan items"
  on public.sprint_plan_items for update
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = sprint_plan_items.session_id
        and s.facilitator_id = auth.uid()
    )
  );

create policy "Facilitator can delete sprint plan items"
  on public.sprint_plan_items for delete
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = sprint_plan_items.session_id
        and s.facilitator_id = auth.uid()
    )
  );
