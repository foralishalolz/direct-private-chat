import { requireUser } from "@/lib/requireUser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/@chat\.local$/i, "");
}

export async function POST(request: Request) {
  const check = await requireUser(request);
  if (!check.ok) return check.response;

  let body: { partnerUsername?: unknown };
  try {
    body = (await request.json()) as { partnerUsername?: unknown };
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const partnerUsername =
    typeof body.partnerUsername === "string" ? normalizeUsername(body.partnerUsername) : "";

  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(partnerUsername)) {
    return Response.json({ error: "Enter a valid partner username." }, { status: 400 });
  }

  const me = await check.admin.from("profiles").select("username").eq("id", check.userId).maybeSingle();
  if (me.error || !me.data) {
    return Response.json({ error: "Your profile was not found." }, { status: 500 });
  }

  if ((me.data.username as string).toLowerCase() === partnerUsername) {
    return Response.json({ error: "You can't become your own couple." }, { status: 400 });
  }

  const partner = await check.admin
    .from("profiles")
    .select("id, username")
    .eq("username", partnerUsername)
    .maybeSingle();

  if (partner.error || !partner.data) {
    return Response.json({ error: "No user with that username." }, { status: 404 });
  }

  // Bail out if either of them is already in a couple together.
  const { data: myMemberships } = await check.admin
    .from("couple_members")
    .select("couple_id")
    .eq("user_id", check.userId);

  const myCoupleIds = (myMemberships ?? []).map((row) => row.couple_id as string);

  if (myCoupleIds.length > 0) {
    const { data: partnerMemberships } = await check.admin
      .from("couple_members")
      .select("couple_id")
      .eq("user_id", partner.data.id)
      .in("couple_id", myCoupleIds);

    if ((partnerMemberships ?? []).length > 0) {
      return Response.json({ error: "You're already in a couple together." }, { status: 409 });
    }
  }

  const { data: couple, error: createError } = await check.admin
    .from("couples")
    .insert({ name: null, created_by: check.userId })
    .select("id, name, created_by, created_at")
    .single();

  if (createError || !couple) {
    return Response.json({ error: "Could not create the couple." }, { status: 500 });
  }

  const { error: membersError } = await check.admin.from("couple_members").insert([
    { couple_id: couple.id, user_id: check.userId, cute_role: "kitten" },
    { couple_id: couple.id, user_id: partner.data.id, cute_role: "daddy" },
  ]);

  if (membersError) {
    await check.admin.from("couples").delete().eq("id", couple.id);
    return Response.json({ error: "Could not create the couple." }, { status: 500 });
  }

  return Response.json(
    { couple: { id: couple.id, name: couple.name, created_by: couple.created_by, created_at: couple.created_at } },
    { status: 201 },
  );
}
