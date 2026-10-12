-- Run in the Supabase SQL Editor. The application writes with its server-only
-- service role key; browser clients receive no access policy to this table.
create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  user_id text not null,
  name text not null,
  role text not null check (role in ('inputer', 'admin', 'administrator', 'manager')),
  logged_at timestamptz not null default now()
);

create index if not exists login_events_logged_at_idx
  on public.login_events (logged_at desc);

alter table public.login_events enable row level security;
