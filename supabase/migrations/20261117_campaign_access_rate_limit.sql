-- Basic per-IP throttling for campaign access-code redemption.
create table if not exists private.campaign_access_attempts (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);

alter table private.campaign_access_attempts enable row level security;
revoke all on private.campaign_access_attempts from public, anon, authenticated;
grant all on private.campaign_access_attempts to service_role;

create or replace function private.consume_campaign_access_attempt(
  p_fingerprint text,
  p_limit integer default 10,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_attempts integer;
begin
  insert into private.campaign_access_attempts(fingerprint, window_started_at, attempts)
  values (p_fingerprint, now(), 1)
  on conflict (fingerprint) do update
    set attempts = case
          when campaign_access_attempts.window_started_at < now() - make_interval(secs => p_window_seconds) then 1
          else campaign_access_attempts.attempts + 1
        end,
        window_started_at = case
          when campaign_access_attempts.window_started_at < now() - make_interval(secs => p_window_seconds) then now()
          else campaign_access_attempts.window_started_at
        end
  returning attempts into v_attempts;

  return v_attempts <= p_limit;
end;
$$;

revoke all on function private.consume_campaign_access_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function private.consume_campaign_access_attempt(text, integer, integer) to service_role;
