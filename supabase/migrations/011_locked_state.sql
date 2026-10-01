-- Add a "locked" session state: participants can keep adjusting their vote
-- live while a session is "revealed" (discussion in progress); the
-- facilitator explicitly "locks" votes to freeze further changes before
-- submitting final points to Jira.
alter table public.sessions
  drop constraint sessions_state_check;

alter table public.sessions
  add constraint sessions_state_check
  check (state in ('voting', 'revealed', 'locked'));

-- Votes must remain readable by everyone once locked, not just while revealed.
drop policy "Users can read all votes when session is revealed" on public.votes;

create policy "Users can read all votes when session is revealed"
  on public.votes for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = votes.session_id
        and s.state in ('revealed', 'locked')
    )
  );
