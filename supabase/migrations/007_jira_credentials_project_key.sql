alter table public.jira_credentials
  add column if not exists project_key text;
