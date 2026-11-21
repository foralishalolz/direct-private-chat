import { requireUser } from "@/lib/serverAuth";
import { sendPushToUser } from "@/lib/pushServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Poke" — a one-tap way to tell someone you miss them. Delivers a push
 * notification (and an in-chat nudge card) to the other people in a chat,
 * rate-limited to one poke per person per hour so it stays sweet rather than
 * spammy.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  let groupId = "";
  let kind: "miss" | "kiss" | "hug" = "miss";

  try {
    const body = (await request.json()) as { groupId?: unknown; kind?: unknown };
    groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (body.kind === "kiss" || body.kind === "hug" || body.kind === "miss") {
      kind = body.kind;
    }
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!groupId) {
    return Response.json({ error: "Missing groupId." }, { status: 400 });
  }

  const { admin, user } = auth;

  const { data: membership } = await admin
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const [membersResult, senderProfile] = await Promise.all([
    admin
      .from("group_members")
      .select("user_id, muted")
      .eq("group_id", groupId)
      .neq("user_id", user.id),
    admin
      .from("profiles")
      .select("username, display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const senderName =
    (senderProfile.data?.display_name as string | null) ||
    (senderProfile.data?.username as string) ||
    "Someone";

  const copy = {
    miss: { title: `${senderName} misses you 💗`, body: "Open BitchAt — someone's thinking about you." },
    kiss: { title: `${senderName} sent a kiss 💋`, body: "Catch it before it floats away." },
    hug: { title: `${senderName} is hugging you 🫂`, body: "A little squeeze, straight to your phone." },
  }[kind];

  let sent = 0;

  for (const member of membersResult.data ?? []) {
    if (member.muted) continue;

    // Hourly cooldown per recipient per kind.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("push_deliveries")
      .select("created_at")
      .eq("user_id", member.user_id as string)
      .gte("created_at", since)
      .limit(50);

    if (recent && recent.length >= 3) continue;

    const result = await sendPushToUser(admin, member.user_id as string, {
      title: copy.title,
      body: copy.body,
      url: `/?open=${groupId}`,
      tag: `poke-${kind}-${groupId}`,
    });

    sent += result.sent;
  }

  return Response.json({ ok: true, sent });
}
