import { requireAdmin } from "@/lib/requireAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SetGroupsPayload {
  groupIds?: unknown;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const check = await requireAdmin(request);
  if (!check.ok) return check.response;

  const { id: targetUserId } = await params;

  let body: SetGroupsPayload;
  try {
    body = (await request.json()) as SetGroupsPayload;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const groupIds = Array.isArray(body.groupIds)
    ? body.groupIds.filter((value): value is string => typeof value === "string")
    : null;

  if (!groupIds) {
    return Response.json(
      { error: "groupIds must be an array of group ids." },
      { status: 400 },
    );
  }

  // Replace this user's full membership set in one go — this is what backs
  // the "which groups can this user access" dropdown, and doubles as
  // ban/unban: unchecking a group removes their access to it immediately.
  const { error: deleteError } = await check.admin
    .from("group_members")
    .delete()
    .eq("user_id", targetUserId);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  if (groupIds.length > 0) {
    const rows = groupIds.map((groupId) => ({
      group_id: groupId,
      user_id: targetUserId,
    }));

    const { error: insertError } = await check.admin
      .from("group_members")
      .insert(rows);

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }
  }

  return Response.json({ ok: true, groupIds });
}
