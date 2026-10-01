alter table public.jira_credentials
  add column if not exists ac_field text;
