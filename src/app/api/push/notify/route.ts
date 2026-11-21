import { requireUser } from "@/lib/serverAuth";
import { pushPreviewForMessage, sendPushToUser } from "@/lib/pushServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fan-out endpoint for new messages.
 *
 * The client calls this right after inserting a message (fire-and-forget). The
 * route re-reads the message from the database with the service role, so a
 * caller can't spoof content or notify for messages that don't exist. Every
 * recipient's existing push_deliveries row prevents duplicate nudges.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  let messageId = "";
  try {
    const body = (await request.json()) as { messageId?: unknown };
    messageId = typeof body.messageId === "string" ? body.messageId : "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!messageId) {
    return Response.json({ error: "Missing messageId." }, { status: 400 });
  }

  const { admin, user } = auth;

  const { data: message } = await admin
    .from("messages")
    .select("id, group_id, user_id, content, kind, created_at")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }

  // Only the author may trigger the fan-out for their own message.
  if (message.user_id !== user.id) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const [groupResult, membersResult, senderProfile] = await Promise.all([
    admin.from("groups").select("id, name, is_direct").eq("id", message.group_id).maybeSingle(),
    admin
      .from("group_members")
      .select("user_id, muted")
      .eq("group_id", message.group_id)
      .neq("user_id", user.id),
    admin
      .from("profiles")
      .select("username, display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const group = groupResult.data;
  const members = membersResult.data ?? [];
  const senderName =
    (senderProfile.data?.display_name as string | null) ||
    (senderProfile.data?.username as string) ||
    "Someone";

  if (!group || members.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const title = group.is_direct
    ? senderName
    : `${senderName} · ${group.name}`;
  const preview = pushPreviewForMessage(message);

  let sent = 0;

  await Promise.all(
    members.map(async (member) => {
      if (member.muted) return;

      // Deduplicate: skip if this device-owner was already notified.
      const { data: existing } = await admin
        .from("push_deliveries")
        .select("message_id")
        .eq("message_id", messageId)
        .eq("user_id", member.user_id)
        .maybeSingle();

      if (existing) return;

      const result = await sendPushToUser(admin, member.user_id as string, {
        title,
        body: preview || "New message",
        url: `/?open=${message.group_id}`,
        tag: `msg-${message.group_id}`,
      });

      if (result.sent > 0) {
        sent += result.sent;
        await admin
          .from("push_deliveries")
          .upsert(
            { message_id: messageId, user_id: member.user_id },
            { onConflict: "message_id,user_id", ignoreDuplicates: true },
          );
      }
    }),
  );

  return Response.json({ ok: true, sent });
}
