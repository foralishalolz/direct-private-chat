// Server-only module. Never import this from a Client Component.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface AdminContext {
  admin: SupabaseClient;
  userId: string;
}

interface AdminCheckFailure {
  ok: false;
  response: Response;
}

interface AdminCheckSuccess extends AdminContext {
  ok: true;
}

export async function requireAdmin(
  request: Request,
): Promise<AdminCheckSuccess | AdminCheckFailure> {
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

  const { data: userData, error: userError } = await admin.auth.getUser(
    token,
  );

  if (userError || !userData.user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin") {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return { ok: true, admin, userId: userData.user.id };
}
