-- Sprint plan destination: the plan becomes a live view of what the target
-- sprint will contain, rather than a build-from-empty queue.
--
-- `origin` distinguishes tickets pulled in because they are *already* in the
-- destination sprint from tickets the host queued during the session. Changing
-- the destination drops the former and keeps the latter.
--
-- `removed` stages a sprint-origin ticket for removal: the row is kept (so the
-- host can undo, and so commit knows which keys to push back to the backlog)
-- but is excluded from the plan list and its totals.
--
-- Both columns default to today's semantics, so rows in a live session are
-- unaffected by this migration.

alter table public.sprint_plan_items
  add column origin text not null default 'added'
    check (origin in ('added', 'sprint')),
  add column removed boolean not null default false;

-- The host's chosen destination. Persisted (rather than left as client state)
-- so it survives reload and is broadcast to every participant. A null
-- target_sprint_id means "no existing sprint selected" — either nothing chosen
-- yet, or the host is creating a new sprint.
alter table public.sessions
  add column target_board_id integer,
  add column target_sprint_id integer,
  add column target_sprint_name text;
