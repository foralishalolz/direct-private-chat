import { requireAdmin } from "@/lib/requireAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const check = await requireAdmin(request);
  if (!check.ok) return check.response;

  const { data: profiles, error: profilesError } = await check.admin
    .from("profiles")
    .select("id, username, role, created_at")
    .order("created_at", { ascending: true });

  if (profilesError) {
    return Response.json({ error: profilesError.message }, { status: 500 });
  }

  const { data: memberships, error: membershipsError } = await check.admin
    .from("group_members")
    .select("user_id, group_id");

  if (membershipsError) {
    return Response.json({ error: membershipsError.message }, { status: 500 });
  }

  const groupIdsByUser = new Map<string, string[]>();
  for (const row of memberships ?? []) {
    const existing = groupIdsByUser.get(row.user_id) ?? [];
    existing.push(row.group_id);
    groupIdsByUser.set(row.user_id, existing);
  }

  const users = (profiles ?? []).map((profile) => ({
    ...profile,
    groupIds: groupIdsByUser.get(profile.id) ?? [],
  }));

  return Response.json({ users });
}
