// Server-only module. Never import this from a Client Component.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface UserContext {
  admin: SupabaseClient;
  userId: string;
}

interface UserCheckFailure {
  ok: false;
  response: Response;
}

interface UserCheckSuccess extends UserContext {
  ok: true;
}

/** Authenticates the caller from the Authorization header (any role). */
export async function requireUser(
  request: Request,
): Promise<UserCheckSuccess | UserCheckFailure> {
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

  const { data: userData, error: userError } = await admin.auth.getUser(token);

  if (userError || !userData.user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return { ok: true, admin, userId: userData.user.id };
}
