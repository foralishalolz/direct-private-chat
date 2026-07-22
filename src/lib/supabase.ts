import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function normalizeSupabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;

  let url = rawUrl.trim().replace(/^["']|["']$/g, "");
  if (!url) return undefined;

  // Strip common API sub-paths that break the JS client. The SDK expects the
  // bare project URL (e.g. https://xyz.supabase.co).
  url = url.replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?.*$/i, "");
  url = url.replace(/\/+$/, "");

  return url;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
  ?.trim()
  .replace(/^["']|["']$/g, "");

function hasUsableConfiguration(url?: string, key?: string): url is string {
  if (!url || !key) return false;

  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.protocol === "https:" &&
      !url.includes("your-project-reference") &&
      !key.includes("your-publishable-key") &&
      !key.includes("your-anon-key")
    );
  } catch {
    return false;
  }
}

export const isSupabaseConfigured = hasUsableConfiguration(
  supabaseUrl,
  supabaseKey,
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseKey as string, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storageKey: "private-chat-auth",
      },
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
      global: {
        headers: {
          "x-application-name": "private-chat-web",
        },
      },
    })
  : null;
