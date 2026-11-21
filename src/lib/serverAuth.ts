// Server-only helpers. Never import from a Client Component.
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type AuthResult =
  | { ok: true; admin: SupabaseClient; user: User }
  | { ok: false; response: Response };

/** Verifies the bearer token and returns a service-role client. */
export async function requireUser(request: Request): Promise<AuthResult> {
  const admin = getSupabaseAdmin();

  if (!admin) {
    return {
      ok: false,
      response: Response.json(
        { error: "Server is not configured." },
        { status: 503 },
      ),
    };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return { ok: true, admin, user: data.user };
}
