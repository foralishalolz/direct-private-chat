import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPushConfigured, sendPushToUser } from "@/lib/pushServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled sweeper — hit this every few minutes (Vercel Cron does it from
 * vercel.json). It sends:
 *   1. "starting soon" nudges for plans beginning in the next 15 minutes.
 *   2. a soft "we miss you" ping to anyone with unread messages older than an
 *      hour, at most once per half day.
 *
 * Secured by CRON_SECRET so this can't be spammed from the outside.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);

  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    const provided =
      header.replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("secret");
    if (provided !== secret) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Not configured." }, { status: 503 });
  }

  if (!isPushConfigured()) {
    return Response.json({ ok: true, skipped: "push-not-configured" });
  }

  const now = new Date();
  const in15 = new Date(now.getTime() + 15 * 60 * 1000);

  // ---------------------------------------------------------- plan reminders
  const { data: duePlans } = await admin
    .from("plans")
    .select("id, group_id, title, starts_at, created_by, location")
    .eq("completed", false)
    .eq("notified", false)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", in15.toISOString())
    .limit(50);

  let planNotifications = 0;

  for (const plan of duePlans ?? []) {
    const { data: members } = await admin
      .from("group_members")
      .select("user_id, muted")
      .eq("group_id", plan.group_id);

    const startsAt = new Date(plan.starts_at as string);
    const minutes = Math.max(
      1,
      Math.round((startsAt.getTime() - now.getTime()) / 60000),
    );

    for (const member of members ?? []) {
      if (member.muted) continue;
      const result = await sendPushToUser(admin, member.user_id as string, {
        title: `Starting in ${minutes} min: ${plan.title}`,
        body: plan.location
          ? `Your plan is at ${plan.location}. 💗`
          : "Your plan together starts soon. 💗",
        url: "/?tab=us",
        tag: `plan-${plan.id}`,
      });
      planNotifications += result.sent;
    }

    await admin.from("plans").update({ notified: true }).eq("id", plan.id);
  }

  // ------------------------------------------------------------ miss-you ping
  // Find unread messages older than an hour whose recipient hasn't opened the
  // app since. Cap at one nudge per recipient per 12 hours.
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

  const { data: unread } = await admin
    .from("group_members")
    .select("user_id, group_id, last_read_at, profiles!inner(last_seen_at)")
    .lt("last_read_at", oneHourAgo)
    .limit(200);

  let missYou = 0;
  const handled = new Set<string>();

  for (const row of unread ?? []) {
    const userId = row.user_id as string;
    if (handled.has(userId)) continue;

    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const lastSeen = (profile as { last_seen_at?: string } | null)?.last_seen_at;
    if (lastSeen && new Date(lastSeen).getTime() > new Date(oneHourAgo).getTime()) {
      continue; // They were just here — don't nag.
    }

    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("group_id", row.group_id)
      .neq("user_id", userId)
      .is("deleted_at", null)
      .gt("created_at", (row.last_read_at as string) ?? new Date(0).toISOString())
      .lt("created_at", oneHourAgo);

    if (!count || count === 0) continue;

    // Respect a 12h cooldown: if we already delivered anything to this person
    // in the last half day, don't pile on another "miss you" nudge.
    const { data: recent } = await admin
      .from("push_deliveries")
      .select("message_id, created_at")
      .eq("user_id", userId)
      .gte("created_at", twelveHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      handled.add(userId);
      continue;
    }

    const result = await sendPushToUser(admin, userId, {
      title: "Someone misses you 💗",
      body: `${count} message${count === 1 ? "" : "s"} waiting for you.`,
      url: "/",
      tag: "miss-you",
    });

    missYou += result.sent;
    handled.add(userId);
  }

  return Response.json({
    ok: true,
    plans: planNotifications,
    missYou,
    checkedAt: now.toISOString(),
  });
}
