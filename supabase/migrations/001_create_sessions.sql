create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  code char(6) not null unique,
  facilitator_id uuid not null,
  state text not null default 'voting' check (state in ('voting', 'revealed')),
  current_issue_key text,
  jira_base_url text,
  jira_email text,
  created_at timestamptz not null default now()
);

-- Index for fast code lookups
create index sessions_code_idx on public.sessions (code);

-- Enable RLS
alter table public.sessions enable row level security;
