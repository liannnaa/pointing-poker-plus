create table public.jira_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text not null,
  base_url text not null,
  encrypted_token text not null,
  story_points_field text not null default 'customfield_10026',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.jira_credentials enable row level security;
