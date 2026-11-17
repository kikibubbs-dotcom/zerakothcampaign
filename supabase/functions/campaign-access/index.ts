// Supabase Edge Function: campaign-access
// Secrets required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// ACCESS_CODE_PEPPER, CAMPAIGN_SETUP_SECRET
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
const pepper = Deno.env.get("ACCESS_CODE_PEPPER")!;
const setupSecret = Deno.env.get("CAMPAIGN_SETUP_SECRET")!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("").match(/.{1,4}/g)!.join("-");
}
async function hashCode(code: string) {
  const data = new TextEncoder().encode(pepper + ":" + code.replace(/-/g, "").toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
function memberEmail(id: string) { return "campaign-" + id + "@members.invalid"; }
async function allowRedemption(req: Request) {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  const ip = forwarded.split(",")[0].trim();
  const fingerprint = await hashCode("redeem:" + ip);
  const { data, error } = await admin.schema("private").rpc("consume_campaign_access_attempt", {
    p_fingerprint: fingerprint, p_limit: 10, p_window_seconds: 900
  });
  if (error) throw error;
  return data === true;
}

async function getCaller(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: "Bearer " + token } }, auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}
async function memberForUser(userId: string) {
  const { data, error } = await admin.schema("private").from("campaign_members").select("*").eq("auth_user_id", userId).eq("active", true).single();
  if (error) return null;
  return data;
}
async function issueSession(member: any) {
  const email = memberEmail(member.id);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(error?.message || "Could not create sign-in token.");
  return { email, token_hash: data.properties.hashed_token, type: "magiclink", member: { id: member.id, display_name: member.display_name, role: member.role } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!url || !anonKey || !serviceKey || !pepper || !setupSecret) return json({ error: "The campaign access function is missing required secrets." }, 500);

  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "bootstrap-dm") {
      if (body.setup_secret !== setupSecret) return json({ error: "Invalid setup secret." }, 403);
      const { count, error: countError } = await admin.schema("private").from("campaign_members").select("id", { count: "exact", head: true }).eq("role", "dm");
      if (countError) throw countError;
      if ((count || 0) > 0) return json({ error: "The DM account has already been created. Use the DM account to manage access." }, 409);
      const code = randomCode();
      const id = crypto.randomUUID();
      const email = memberEmail(id);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true, password: Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("") });
      if (createError) throw createError;
      const { data: member, error: insertError } = await admin.schema("private").from("campaign_members").insert({ id, display_name: String(body.display_name || "Dungeon Master").slice(0, 80), role: "dm", auth_user_id: created.user.id, code_hash: await hashCode(code) }).select().single();
      if (insertError) { await admin.auth.admin.deleteUser(created.user.id); throw insertError; }
      return json({ code, message: "Save this DM code somewhere safe. It will not be shown again." });
    }

    if (action === "redeem-code") {
      const code = String(body.code || "").trim();
      if (code.length < 8 || code.length > 40) return json({ error: "Invalid access code." }, 400);
      if (!await allowRedemption(req)) return json({ error: "Too many attempts. Please wait 15 minutes before trying again." }, 429);
      const { data: member, error } = await admin.schema("private").from("campaign_members").select("*").eq("code_hash", await hashCode(code)).eq("active", true).single();
      if (error || !member) return json({ error: "That access code is invalid or has been revoked." }, 403);
      return json(await issueSession(member));
    }

    const caller = await getCaller(req);
    if (!caller) return json({ error: "Please sign in again." }, 401);
    const member = await memberForUser(caller.id);
    if (!member) return json({ error: "This campaign account is inactive." }, 403);

    if (action === "change-code") {
      const current = String(body.current_code || "");
      const next = String(body.new_code || "").trim();
      if (next.length < 12 || next.length > 40) return json({ error: "New codes must be at least 12 characters." }, 400);
      if (await hashCode(current) !== member.code_hash) return json({ error: "Your current code is incorrect." }, 403);
      const { error } = await admin.schema("private").from("campaign_members").update({ code_hash: await hashCode(next), updated_at: new Date().toISOString() }).eq("id", member.id);
      if (error) throw error;
      return json({ success: true, message: "Your access code has been changed. Your campaign identity and content are unchanged." });
    }

    if (action === "create-player") {
      if (member.role !== "dm") return json({ error: "DM access required." }, 403);
      const displayName = String(body.display_name || "").trim().slice(0, 80);
      if (!displayName) return json({ error: "Enter a player name." }, 400);
      const code = randomCode();
      const id = crypto.randomUUID();
      const email = memberEmail(id);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true, password: Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("") });
      if (createError) throw createError;
      const { error } = await admin.schema("private").from("campaign_members").insert({ id, display_name: displayName, role: "player", auth_user_id: created.user.id, code_hash: await hashCode(code) });
      if (error) { await admin.auth.admin.deleteUser(created.user.id); throw error; }
      return json({ code, display_name: displayName, message: "Copy this code now. It will not be shown again." });
    }

    if (action === "list-players") {
      if (member.role !== "dm") return json({ error: "DM access required." }, 403);
      const { data, error } = await admin.schema("private").from("campaign_members")
        .select("id,display_name,active,created_at,updated_at")
        .eq("role", "player").order("display_name", { ascending: true });
      if (error) throw error;
      return json({ players: data || [] });
    }

    if (action === "reset-player-code") {
      if (member.role !== "dm") return json({ error: "DM access required." }, 403);
      const targetId = String(body.member_id || "");
      const code = randomCode();
      const { data: target, error: targetError } = await admin.schema("private").from("campaign_members")
        .select("id,display_name").eq("id", targetId).eq("role", "player").eq("active", true).single();
      if (targetError || !target) return json({ error: "Active player not found." }, 404);
      const { error } = await admin.schema("private").from("campaign_members")
        .update({ code_hash: await hashCode(code), updated_at: new Date().toISOString() }).eq("id", targetId);
      if (error) throw error;
      return json({ code, display_name: target.display_name, message: "The previous code is now invalid. Copy this new code now." });
    }

    if (action === "revoke-player") {
      if (member.role !== "dm") return json({ error: "DM access required." }, 403);
      const targetId = String(body.member_id || "");
      const { data: target, error: targetError } = await admin.schema("private").from("campaign_members").select("id,auth_user_id,role").eq("id", targetId).eq("role", "player").single();
      if (targetError || !target) return json({ error: "Player not found." }, 404);
      const { error } = await admin.schema("private").from("campaign_members").update({ active: false, updated_at: new Date().toISOString() }).eq("id", targetId);
      if (error) throw error;
      await admin.auth.admin.deleteUser(target.auth_user_id);
      return json({ success: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("campaign-access error", error);
    return json({ error: "The access request could not be completed. Check the function logs for details." }, 500);
  }
});
