// supabase/functions/_shared/client.ts
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  const key = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
export async function readJson(
  req: Request,
  limit = 2048,
): Promise<Record<string, unknown>> {
  if (!req.body) throw new Error("Empty request");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || Array.isArray(data) || typeof data !== "object")
    throw new Error("Invalid request");
  return data;
}

export function publishableRequest(req: Request): boolean {
  const supplied = req.headers.get("apikey");
  if (!supplied) return false;
  const keys: Record<string, string> = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
  return Object.values(keys).includes(supplied) || supplied === Deno.env.get("SUPABASE_ANON_KEY");
}
