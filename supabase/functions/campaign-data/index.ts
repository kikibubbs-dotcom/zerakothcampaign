// Supabase Edge Function: campaign-data
// All campaign writes pass through this function. The service-role key never reaches the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://kikibubbs-dotcom.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function authenticate(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}
async function getMember(userId: string) {
  const { data, error } = await admin.schema("private").from("campaign_members")
    .select("id,display_name,role,active").eq("auth_user_id", userId).eq("active", true).single();
  if (error) return null;
  return data;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const asArray = (value: unknown) => Array.isArray(value) ? value : null;

function validatePlayerChange(before: any, after: any, memberId: string) {
  if (!after || typeof after !== "object" || Array.isArray(after)) return "Campaign data is invalid.";
  const allowed = new Set(["characters", "journal", "events"]);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (!allowed.has(key) && !same(before?.[key], after?.[key])) {
      return "Your account cannot change the " + key + " section.";
    }
  }

  for (const collection of ["characters", "journal", "events"]) {
    const oldItems = asArray(before?.[collection]);
    const newItems = asArray(after?.[collection]);
    if (!oldItems || !newItems) return "Campaign collection is invalid: " + collection + ".";
    const oldById = new Map<string, any>(oldItems.map((item: any) => [String(item?.id), item] as [string, any]));
    const newById = new Map<string, any>(newItems.map((item: any) => [String(item?.id), item] as [string, any]));
    if (newById.size !== newItems.length) return "Duplicate entries are not allowed.";

    for (const [id, oldItem] of oldById) {
      const newItem: any = newById.get(id);
      if (collection === "characters") {
        const isOwner = (oldItem as any)?.ownerId === memberId;
        if (!isOwner && (!newItem || !same(oldItem, newItem))) {
          return "You can only edit or remove your own character.";
        }
        if (isOwner && newItem && newItem.ownerId !== memberId) {
          return "A character cannot be transferred to another account.";
        }
        if (newItem && newItem.isNPC) {
          return "Player-owned characters cannot be changed into NPC companions.";
        }
      } else if (newItem && (oldItem as any)?.ownerId && newItem.ownerId !== (oldItem as any).ownerId) {
        return "An entry's original author cannot be changed.";
      }
    }
    for (const [id, newItem] of newById) {
      if (!oldById.has(id)) {
        if ((newItem as any)?.ownerId !== memberId) return "New " + collection + " entries must be attributed to your account.";
        if (collection === "characters" && (newItem as any)?.isNPC) return "Players cannot create NPC companions.";
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!url || !anonKey || !serviceKey) return json({ error: "The campaign data function is missing Supabase configuration." }, 500);

  try {
    const user = await authenticate(req);
    if (!user) return json({ error: "Please sign in with your campaign access code first." }, 401);
    const member = await getMember(user.id);
    if (!member) return json({ error: "This campaign account is inactive or unavailable." }, 403);

    const body = await req.json();
    const action = String(body.action || "");

    if (action === "load") {
      const { data, error } = await admin.from("campaign_hub").select("data,updated_at").eq("id", "main").single();
      if (error) throw error;
      return json({ data: data.data, updated_at: data.updated_at, member });
    }

    if (action === "save-state") {
      const next = body.data;
      if (!next || typeof next !== "object" || Array.isArray(next)) return json({ error: "Campaign data is invalid." }, 400);
      if (JSON.stringify(next).length > 2_000_000) return json({ error: "Campaign data is too large." }, 413);

      const { data: current, error: readError } = await admin.from("campaign_hub")
        .select("data").eq("id", "main").single();
      if (readError) throw readError;
      const before = current.data || {};

      if (member.role !== "dm") {
        const problem = validatePlayerChange(before, next, member.id);
        if (problem) return json({ error: problem }, 403);
      }

      const { data: saved, error: saveError } = await admin.schema("private").rpc("save_campaign_data", {
        p_expected: before,
        p_next: next,
      });
      if (saveError) throw saveError;
      if (!saved) return json({ error: "The campaign changed while you were saving. Reload the latest version and try again.", conflict: true }, 409);
      return json({ success: true, updated_at: new Date().toISOString() });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("campaign-data error", error);
    return json({ error: "The campaign request could not be completed. Check the Edge Function logs for details." }, 500);
  }
});
