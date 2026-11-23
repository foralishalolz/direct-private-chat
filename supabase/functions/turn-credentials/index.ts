import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: "Unauthorized" }, 401);
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const key = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL"), id = Deno.env.get("CLOUDFLARE_TURN_TOKEN_ID"), secret = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN");
    if (!url || !key || !id || !secret || !/^[a-f0-9]{32}$/i.test(id)) return json({ error: "Call relay unavailable." }, 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > 1024) return json({ error: "Invalid request" }, 400);
    if (!req.body) return json({ error: "Invalid request" }, 400);
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); return json({ error: "Invalid request" }, 400); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    const { callId } = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof callId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callId)) return json({ error: "Invalid request" }, 400);
    const { data: allowed, error: reserveError } = await admin.rpc("reserve_turn_credential", { p_user: user.id, p_call: callId });
    if (reserveError) return json({ error: "Call relay unavailable." }, 503);
    if (!allowed) return json({ error: "Call relay unavailable or request limit reached." }, 403);
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: "POST", headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return json({ error: "Call relay unavailable." }, 503);
    const data = await response.json();
    if (!Array.isArray(data.iceServers) || !data.iceServers.some((server: { urls?: string | string[] }) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(value => typeof value === "string" && /^turns?:/i.test(value)))) return json({ error: "Call relay unavailable." }, 503);
    return json({ iceServers: data.iceServers });
  } catch { return json({ error: "Call relay unavailable." }, 503); }
});
