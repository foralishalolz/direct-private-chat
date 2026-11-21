// Server-only web push sender. Never import from a Client Component.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as webpushModule from "web-push";

const webpush = ((webpushModule as unknown as { default?: typeof webpushModule })
  .default ?? webpushModule) as typeof webpushModule;

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  image?: string;
  renotify?: boolean;
  vibrate?: number[];
}

let configured = false;

function configure(): boolean {
  if (configured) return true;

  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY;
  const privateKey =
    process.env.VAPID_PRIVATE_KEY ?? process.env.NEXT_PUBLIC_VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@bitchat.app";

  if (!publicKey || !privateKey) return false;

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    return true;
  } catch {
    return false;
  }
}

export function isPushConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY) &&
      (process.env.VAPID_PRIVATE_KEY ?? process.env.NEXT_PUBLIC_VAPID_PRIVATE_KEY),
  );
}

/**
 * Sends a notification to every device registered for a user. Stale
 * subscriptions (410 Gone / 404) are pruned automatically.
 */
export async function sendPushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error || !subscriptions || subscriptions.length === 0) {
    return { sent: 0, pruned: 0 };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? "bitchat",
    icon: payload.icon ?? "/icons/icon-192.png",
    image: payload.image,
    renotify: payload.renotify ?? true,
    vibrate: payload.vibrate ?? [18, 40, 18],
  });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint as string,
            keys: {
              p256dh: subscription.p256dh as string,
              auth: subscription.auth as string,
            },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
      } catch (pushError) {
        const statusCode = (pushError as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(subscription.id as string);
        }
      }
    }),
  );

  if (staleIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", staleIds);
  }

  return { sent, pruned: staleIds.length };
}

/** Short human-friendly preview for a message row. */
export function pushPreviewForMessage(message: {
  content?: string | null;
  kind?: string | null;
}): string {
  const text = message.content?.trim() ?? "";
  switch (message.kind) {
    case "image":
      return text ? `📷 ${text}` : "Sent a photo";
    case "video":
      return text ? `🎥 ${text}` : "Sent a video";
    case "audio":
      return "Sent a voice note";
    case "sticker":
      return text || "Sent a sticker";
    default:
      return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  }
}
