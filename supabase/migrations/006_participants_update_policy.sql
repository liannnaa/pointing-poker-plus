-- Allow users to update their own participant row (needed for upsert on re-join)
create policy "Users can update their own participant"
  on public.participants for update
  to anon, authenticated
  using (auth.uid() = user_id);
