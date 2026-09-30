// Only the database worker can invoke this function. User subscriptions use authenticated RPCs.
import webpush from "npm:web-push@3.6.7";
import { adminClient } from "../_shared/client.ts";

type Config = { publicKey: string; privateKey: string; subject: string };
import { endpointAllowed, pushPayload, type PushJob } from "../_shared/push.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const secret = req.headers.get("x-push-secret");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return new Response(null, { status: 401 });
  try {
    const admin = adminClient();
    const { data: initial, error: authError } = await admin.rpc("push_server_config", { p_secret: secret });
    if (authError || !initial) return new Response(null, { status: 401 });
    let config: Config = initial;
    if (!config.publicKey || !config.privateKey) {
      const keys = webpush.generateVAPIDKeys();
      const { data, error } = await admin.rpc("store_push_vapid", { p_secret: secret, p_public: keys.publicKey, p_private: keys.privateKey });
      if (error || !data?.privateKey) throw new Error("Push configuration unavailable.");
      config = data;
    }
    let sent = 0, failures = 0;
    const started = Date.now();
    for (let round = 0; round < 3 && Date.now() - started < 45000; round++) {
      const { data, error } = await admin.rpc("claim_push_jobs", { p_secret: secret });
      if (error) throw error;
      const jobs: PushJob[] = data ?? [];
      if (!jobs.length) break;
      // Six simultaneous requests keep delivery quick without exhausting Edge resources.
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
        for (;;) {
          const job = jobs[index++];
          if (!job) return;
          let status = 400;
          if (endpointAllowed(job.endpoint)) {
            try {
              const request = webpush.generateRequestDetails(
                { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_secret } },
                pushPayload(job),
                { vapidDetails: config, TTL: 3600, contentEncoding: "aes128gcm", urgency: "normal", topic: job.conversation_id.replaceAll("-", "") },
              );
              const response = await fetch(request.endpoint, { method: "POST", headers: request.headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(8000) });
              status = response.status;
              await response.body?.cancel();
            } catch { status = 503; }
          }
          const { error: finishError } = await admin.rpc("finish_push_job", {
            p_secret: secret, p_subscription: job.subscription_id, p_conversation: job.conversation_id,
            p_message: job.message_id, p_lease: job.lease, p_status: status,
          });
          if (status >= 200 && status < 300 && !finishError) sent++; else failures++;
        }
      }));
    }
    return Response.json({ ready: true, sent, failures }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never log endpoints, signing keys, auth secrets or user content.
    return Response.json({ error: "Notification delivery will be retried." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
