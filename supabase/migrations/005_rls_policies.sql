-- Sessions: anyone authenticated can read, only facilitator can update
create policy "Anyone can read sessions"
  on public.sessions for select
  to anon, authenticated
  using (true);

create policy "Authenticated users can create sessions"
  on public.sessions for insert
  to anon, authenticated
  with check (auth.uid() = facilitator_id);

create policy "Facilitator can update their session"
  on public.sessions for update
  to anon, authenticated
  using (auth.uid() = facilitator_id);

-- Participants: anyone in the session can read, authenticated can insert themselves
create policy "Anyone can read participants"
  on public.participants for select
  to anon, authenticated
  using (true);

create policy "Users can add themselves as participants"
  on public.participants for insert
  to anon, authenticated
  with check (auth.uid() = user_id);

-- Votes: hidden pre-reveal (only your own visible), all visible post-reveal
create policy "Users can read own votes"
  on public.votes for select
  to anon, authenticated
  using (auth.uid() = user_id);

create policy "Users can read all votes when session is revealed"
  on public.votes for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = votes.session_id
        and s.state = 'revealed'
    )
  );

create policy "Users can insert their own votes"
  on public.votes for insert
  to anon, authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own votes"
  on public.votes for update
  to anon, authenticated
  using (auth.uid() = user_id);

-- Jira credentials: deny all access to anon/authenticated (service-role only)
-- No policies = no access since RLS is enabled
