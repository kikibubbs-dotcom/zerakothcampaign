-- Campaign access-code foundation.
-- Safe to apply while the current site is live: this creates private storage only.
-- It deliberately does NOT change campaign_hub or Storage policies yet.
create schema if not exists private;

create table if not exists private.campaign_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role text not null check (role in ('dm','player')),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  code_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.campaign_members enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on private.campaign_members from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on private.campaign_members to service_role;

comment on table private.campaign_members is
  'Private campaign access identities. Access codes are stored only as peppered SHA-256 hashes; never expose this table to clients.';
