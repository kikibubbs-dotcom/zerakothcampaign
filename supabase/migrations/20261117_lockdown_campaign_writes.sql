-- FINAL LOCKDOWN. Apply only after the authenticated frontend and both Edge Functions
-- are deployed and tested. Applying this to the old main-branch frontend will break saves.

alter table public.campaign_hub enable row level security;

revoke all on table public.campaign_hub from public, anon, authenticated;
grant select on table public.campaign_hub to authenticated, service_role;

drop policy if exists campaign_hub_authenticated_read on public.campaign_hub;
create policy campaign_hub_authenticated_read
  on public.campaign_hub
  for select
  to authenticated
  using (id = 'main');

-- Signed map uploads are issued only by campaign-data after verifying the DM role.
-- These restrictive policies block direct browser writes to this bucket even if an
-- older broad permissive Storage policy still exists. Other buckets are unaffected.
drop policy if exists campaign_maps_deny_client_insert on storage.objects;
create policy campaign_maps_deny_client_insert
  on storage.objects as restrictive
  for insert to anon, authenticated
  with check (bucket_id <> 'campaign-maps');

drop policy if exists campaign_maps_deny_client_update on storage.objects;
create policy campaign_maps_deny_client_update
  on storage.objects as restrictive
  for update to anon, authenticated
  using (bucket_id <> 'campaign-maps')
  with check (bucket_id <> 'campaign-maps');

drop policy if exists campaign_maps_deny_client_delete on storage.objects;
create policy campaign_maps_deny_client_delete
  on storage.objects as restrictive
  for delete to anon, authenticated
  using (bucket_id <> 'campaign-maps');
