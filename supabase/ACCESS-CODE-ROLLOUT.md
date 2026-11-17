# Secure campaign access rollout

This folder contains the access-code identity system and the authenticated campaign data layer. All work is on the development branch until it has been tested.

## Intended experience
- The DM has a separate access code and can create named player accounts.
- Players enter their personal code to receive a Supabase Auth session.
- Players can change their own access code. The old code is invalidated immediately for future sign-ins.
- The DM can list, create, reset, and revoke player access codes.
- Codes are only shown when created or reset; only a peppered SHA-256 hash is stored.
- A stable member UUID links each player to their character and their journal/calendar contributions, even after their code changes.

## Current implementation
- `campaign-access` handles code redemption, session creation, code changes, DM player management, and per-IP redemption throttling.
- `campaign-data` authenticates each request and enforces the role/ownership rules before loading or saving campaign data.
- `private.save_campaign_data` performs a compare-and-swap update so simultaneous saves cannot silently overwrite one another.
- The frontend access screen, account panel, DM player controls, and initial role-based interface are on the development branch.
- Player characters use an `ownerId` matching the stable member ID; players can only edit their own character.
- Journal entries and calendar events record their creator in `ownerId`, while all campaign players can collaboratively add, edit, and delete shared entries/events.

## Important current-state warning
The live/main branch still uses direct browser writes to the shared `campaign_hub` row and the existing Storage bucket. The old anonymous write permissions have deliberately NOT been removed yet. The replacement frontend and server functions must be deployed and tested first; only then should the lockdown migration remove direct anonymous writes and restrict Storage uploads. Do not invite players or treat the system as production-secure until that final lockdown is applied.

## Deployment order
1. The identity migration has already been applied: `migrations/20261117_campaign_members.sql`.
2. Apply `migrations/20261117_secure_campaign_saves.sql`.
3. Apply `migrations/20261117_campaign_access_rate_limit.sql`.
4. Deploy/redeploy the updated `campaign-access` Edge Function.
5. Deploy the new `campaign-data` Edge Function.
6. Ensure the Supabase `private` schema remains in Exposed schemas for the service-side RPC calls, while its tables and functions remain inaccessible to `anon` and `authenticated`.
7. Deploy the development frontend and test DM sign-in, player sign-in, player code changes, DM player creation/reset/revocation, own-character edits, own journal/event edits, and denied edits to DM-only content.
8. Only after those tests pass, apply a separate lockdown migration for `campaign_hub` and `campaign-maps` Storage. Preserve read/realtime access as needed, but remove browser write access and route all changes through the authenticated server layer.

## Secrets and deployment safety
- Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not create manually named secrets with the `SUPABASE_` prefix.
- Keep `ACCESS_CODE_PEPPER` and `CAMPAIGN_SETUP_SECRET` in Edge Function secrets only.
- Never put the service-role key, setup secret, code hashes, or plaintext access codes in frontend files or GitHub Pages.
- The frontend publishable key is public by design; it is not a service-role key.
