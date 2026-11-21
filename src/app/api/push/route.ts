import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/requireUser";
import { sendNotification, setVapidDetails } from "web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TITLE = 80;
const MAX_BODY = 180;

interface PushPayload {
  type?: unknown;
  groupId?: unknown;
  recipientUserId?: unknown;
  senderName?: unknown;
  title?: unknown;
  body?: unknown;
  url?: unknown;
  tag?: unknown;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function configureWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    publicKey,
    privateKey,
  );
  return true;
}

async function sendToUser(
  admin: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  url: string,
  tag: string,
): Promise<number> {
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error || !subs || subs.length === 0) return 0;

  let sent = 0;
  const staleIds: string[] = [];

  const message = JSON.stringify({ title, body, url, tag, icon: "/icons/icon-192.png" });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
          { TTL: 60 * 60 },
        );
        sent += 1;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) staleIds.push(sub.id);
      }
    }),
  );

  if (staleIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", staleIds);
  }

  return sent;
}

export async function POST(request: Request) {
  const check = await requireUser(request);
  if (!check.ok) return check.response;

  if (!configureWebPush()) {
    return Response.json(
      { error: "Push notifications are not configured on the server." },
      { status: 503 },
    );
  }

  let body: PushPayload;
  try {
    body = (await request.json()) as PushPayload;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type : "";

  // ── 'message': fan out to every member of the group except the sender ──
  if (type === "message") {
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (!groupId) {
      return Response.json({ error: "groupId is required." }, { status: 400 });
    }

    const { data: membership } = await check.admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", check.userId)
      .maybeSingle();

    if (!membership) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: group } = await check.admin
      .from("groups")
      .select("name")
      .eq("id", groupId)
      .maybeSingle();

    const { data: members } = await check.admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    const senderName = truncate(
      (typeof body.senderName === "string" && body.senderName) || "Someone",
      60,
    );

    const title = truncate(
      (typeof body.title === "string" && body.title) || `${senderName} in ${group?.name ?? "a group"}`,
      MAX_TITLE,
    );
    const messageBody = truncate(
      (typeof body.body === "string" && body.body) || "New message",
      MAX_BODY,
    );

    const recipientIds = (members ?? [])
      .map((row) => row.user_id as string)
      .filter((id) => id !== check.userId);

    let sent = 0;
    for (const userId of recipientIds) {
      sent += await sendToUser(check.admin, userId, title, messageBody, "/", `msg-${groupId}`);
    }

    return Response.json({ ok: true, sent });
  }

  // ── 'miss': send a playful push to one couple partner ──
  if (type === "miss") {
    const recipientUserId = typeof body.recipientUserId === "string" ? body.recipientUserId : "";
    if (!recipientUserId || recipientUserId === check.userId) {
      return Response.json({ error: "recipientUserId is required." }, { status: 400 });
    }

    const { data: coupleMembers } = await check.admin
      .from("couple_members")
      .select("couple_id")
      .eq("user_id", check.userId);

    const coupleIds = (coupleMembers ?? []).map((row) => row.couple_id as string);

    let sharesCouple = false;
    if (coupleIds.length > 0) {
      const { data: other } = await check.admin
        .from("couple_members")
        .select("couple_id")
        .eq("user_id", recipientUserId)
        .in("couple_id", coupleIds);
      sharesCouple = (other ?? []).length > 0;
    }

    if (!sharesCouple) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const senderName = truncate(
      (typeof body.senderName === "string" && body.senderName) || "Your partner",
      60,
    );
    const title = truncate(
      (typeof body.title === "string" && body.title) || "Miss you! 💗",
      MAX_TITLE,
    );
    const messageBody = truncate(
      (typeof body.body === "string" && body.body) || `${senderName} is missing you`,
      MAX_BODY,
    );

    const sent = await sendToUser(
      check.admin,
      recipientUserId,
      title,
      messageBody,
      "/",
      "miss-you",
    );

    return Response.json({ ok: true, sent });
  }

  return Response.json({ error: "Unknown push type." }, { status: 400 });
}
