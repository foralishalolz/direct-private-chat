export type PushJob = { subscription_id: string; conversation_id: string; message_id: string; user_id: string; endpoint: string; p256dh: string; auth_secret: string; lease: string };

export function endpointAllowed(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return endpoint.length <= 2048 && url.pathname.length > 1 && url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443") &&
      (url.hostname === "fcm.googleapis.com" || url.hostname === "web.push.apple.com" || url.hostname === "push.services.mozilla.com" ||
        url.hostname.endsWith(".push.services.mozilla.com") || url.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export function pushPayload(job: Pick<PushJob, "user_id" | "conversation_id" | "message_id">) {
  return JSON.stringify({ userId: job.user_id, conversationId: job.conversation_id, messageId: job.message_id, timestamp: Date.now() });
}

export type CallPushJob = PushJob & { call_id: string | null; kind: string };

/**
 * A ringing call must feel like a phone call: high urgency, no collapse, and a
 * distinct tag so it never overwrites a message notification. The payload only
 * carries ids — never names, content or media.
 */
export function callPushPayload(job: Pick<PushJob, "user_id" | "conversation_id"> & { call_id: string }) {
  return JSON.stringify({
    userId: job.user_id,
    conversationId: job.conversation_id,
    callId: job.call_id,
    kind: "call",
    timestamp: Date.now(),
  });
}

export const isCallJob = (job: { kind?: string | null }) => job.kind === "call";
