# Secure campaign access rollout

This folder contains the first, non-disruptive stage of the access-code system.

## Intended experience
- DM provisions a separate DM access code and creates named player codes.
- A player redeems their code to receive a normal Supabase Auth session.
- Once signed in, a player can change their own code in Account Settings. The old code is invalidated immediately.
- The DM can create, reset, and revoke player codes.
- Codes are only shown at creation/reset time; only a peppered hash is stored.
- A player's identity is the stable member UUID/Auth user, not their current code, so changing a code does not detach their character, journal entries, events, or read receipts.

## Important current-state warning
The live app currently reads and writes one shared campaign_hub JSONB row directly from the browser. The existing anonymous write access must not be removed until the replacement authenticated write path and its permission checks are deployed and tested. Doing so early would break the live campaign. This first migration therefore creates only the private identity table and does not change live access policies.

## Deployment order
1. Apply migrations/20261117_campaign_members.sql.
2. Deploy the campaign-access Edge Function and set its secrets (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ACCESS_CODE_PEPPER, and a long random CAMPAIGN_SETUP_SECRET).
3. Bootstrap the DM identity using the setup secret; store the returned DM code somewhere safe.
4. Add the sign-in, account settings, and DM code-management screens to the frontend.
5. Route every campaign write through a server-validated function/RPC and verify the permission matrix.
6. Only then apply the separate lockdown migration that removes anonymous writes and restricts reads/writes appropriately.

Do not put the service-role key, setup secret, code hashes, or plaintext access codes in app.js, HTML, CSS, or GitHub Pages.
