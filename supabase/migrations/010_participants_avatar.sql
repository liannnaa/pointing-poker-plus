-- Optional avatar for participants. Stored as a single emoji character (or
-- short grapheme cluster) selected from a small curated set — validated at
-- the application layer (see ALLOWED_AVATARS in src/lib/validation/schemas.ts)
-- so this column intentionally has no CHECK constraint tying it to that list.
alter table public.participants
  add column avatar_emoji text;
