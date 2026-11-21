import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Creates (or returns) the private 1:1 chat between the caller and `userId`.
 *
 * Direct chats get a deterministic description of both username pairs, which
 * we use to look for an existing thread before creating a new one. Rows are
 * written with the service role because group writes are admin-only under RLS.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  let targetId = "";
  try {
    const body = (await request.json()) as { userId?: unknown };
    targetId = typeof body.userId === "string" ? body.userId : "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!targetId || targetId === auth.user.id) {
    return Response.json({ error: "Pick someone else." }, { status: 400 });
  }

  const { admin } = auth;

  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .in("id", [auth.user.id, targetId]);

  if (peopleError || !people || people.length < 2) {
    return Response.json({ error: "That person doesn't exist." }, { status: 404 });
  }

  const me = people.find((person) => person.id === auth.user.id);
  const them = people.find((person) => person.id === targetId);

  if (!me || !them) {
    return Response.json({ error: "That person doesn't exist." }, { status: 404 });
  }

  const sortedNames = [me.username, them.username].sort();
  const directKey = `direct:${sortedNames.join("|")}`;

  // Look for an existing direct thread between these two.
  const { data: existing } = await admin
    .from("groups")
    .select("id, name, description, created_by, is_direct, created_at")
    .eq("description", directKey)
    .eq("is_direct", true)
    .maybeSingle();

  if (existing) {
    return Response.json({ group: existing });
  }

  const displayA =
    (me.display_name as string | null) || (me.username as string);
  const displayB =
    (them.display_name as string | null) || (them.username as string);

  const { data: created, error: createError } = await admin
    .from("groups")
    .insert({
      name: `${displayA} :: ${displayB}`,
      description: directKey,
      is_direct: true,
      created_by: auth.user.id,
    })
    .select("id, name, description, created_by, is_direct, created_at")
    .single();

  if (createError || !created) {
    return Response.json(
      { error: createError?.message ?? "Couldn't start that chat." },
      { status: 500 },
    );
  }

  const { error: memberError } = await admin.from("group_members").insert([
    { group_id: created.id, user_id: auth.user.id },
    { group_id: created.id, user_id: targetId },
  ]);

  if (memberError) {
    await admin.from("groups").delete().eq("id", created.id);
    return Response.json({ error: memberError.message }, { status: 500 });
  }

  // Give the other person a nudge so they know a chat opened.
  void notifyNewChat(admin, targetId, displayA, created.id);

  return Response.json({ group: created }, { status: 201 });
}

async function notifyNewChat(
  admin: SupabaseClient,
  userId: string,
  fromName: string,
  groupId: string,
) {
  try {
    const { sendPushToUser } = await import("@/lib/pushServer");
    await sendPushToUser(admin, userId, {
      title: `${fromName} started a chat with you 💗`,
      body: "Say hi — it's just the two of you in here.",
      url: `/?open=${groupId}`,
      tag: `new-chat-${groupId}`,
    });
  } catch {
    /* push is best-effort */
  }
}
