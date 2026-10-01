create table public.votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  issue_key text not null,
  user_id uuid not null,
  value smallint not null check (value in (1, 2, 3, 5)),
  created_at timestamptz not null default now(),
  unique (session_id, issue_key, user_id)
);

-- Enable RLS
alter table public.votes enable row level security;
