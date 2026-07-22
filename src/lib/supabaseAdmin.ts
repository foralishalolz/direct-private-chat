// Server-only module. Never import this from a Client Component.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function normalizeSupabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;

  let url = rawUrl.trim().replace(/^["']|["']$/g, "");
  if (!url) return undefined;

  url = url.replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?.*$/i, "");
  url = url.replace(/\/+$/, "");

  return url;
}

const adminUrl = normalizeSupabaseUrl(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
);

const adminSecret = (
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
)
  ?.trim()
  .replace(/^["']|["']$/g, "");

export const isAdminConfigured = Boolean(adminUrl && adminSecret);

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!adminUrl || !adminSecret) return null;

  return createClient(adminUrl, adminSecret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
