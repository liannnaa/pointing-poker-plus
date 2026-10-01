create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

-- Enable RLS
alter table public.participants enable row level security;
