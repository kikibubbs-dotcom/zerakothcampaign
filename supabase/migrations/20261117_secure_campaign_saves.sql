-- Secure, compare-and-swap save primitive for the campaign-data Edge Function.
-- This does not change existing client permissions; lockdown is a later migration.
create schema if not exists private;

create or replace function private.save_campaign_data(p_expected jsonb, p_next jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.campaign_hub
     set data = p_next,
         updated_at = now()
   where id = 'main'
     and data is not distinct from p_expected;

  return found;
end;
$$;

revoke all on function private.save_campaign_data(jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.save_campaign_data(jsonb, jsonb) to service_role;
