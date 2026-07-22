import { requireAdmin } from "@/lib/requireAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const check = await requireAdmin(request);
  if (!check.ok) return check.response;

  const { data, error } = await check.admin
    .from("groups")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ groups: data });
}

interface CreateGroupPayload {
  name?: unknown;
  description?: unknown;
}

export async function POST(request: Request) {
  const check = await requireAdmin(request);
  if (!check.ok) return check.response;

  let body: CreateGroupPayload;
  try {
    body = (await request.json()) as CreateGroupPayload;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : null;

  if (name.length < 1 || name.length > 60) {
    return Response.json(
      { error: "Group name must be 1–60 characters." },
      { status: 400 },
    );
  }

  const { data, error } = await check.admin
    .from("groups")
    .insert({
      name,
      description: description || null,
      created_by: check.userId,
    })
    .select("id, name, description, created_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // The admin automatically gets access to every group they create.
  const { error: membershipError } = await check.admin
    .from("group_members")
    .insert({ group_id: data.id, user_id: check.userId });

  if (membershipError) {
    return Response.json({ error: membershipError.message }, { status: 500 });
  }

  return Response.json({ group: data }, { status: 201 });
}
