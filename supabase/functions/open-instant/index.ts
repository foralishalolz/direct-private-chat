// supabase/functions/open-instant/index.ts
import { adminClient, cors, json, readJson } from "../_shared/client.ts";
// Supabase Edge Runtime API; no runtime dependency is needed for this type.
declare const EdgeRuntime: { waitUntil<T>(promise: Promise<T>): Promise<T> };
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: "Unauthorized" }, 401);
    const admin = adminClient();
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);
    if (error || !user) return json({ error: "Unauthorized" }, 401);
    const { messageId } = await readJson(req, 1024);
    if (typeof messageId !== "string" || !/^[0-9a-f-]{36}$/.test(messageId))
      return json({ error: "Invalid request" }, 400);
    const { data: claim, error: claimError } = await admin.rpc("claim_instant_v2", {
      p_id: messageId,
      p_viewer: user.id,
    });
    if (claimError || !claim?.path) return json({ error: "Instant unavailable" }, 410);
    const path = claim.path as string;
    const { data: photo, error: downloadError } = await admin.storage
      .from("instant-media")
      .download(path);
    if (downloadError || !photo)
      return json({ error: "Instant unavailable" }, 410);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(photo.type) ||
      photo.size > 10485760
    )
      return json({ error: "Invalid media" }, 400);
    if (claim.delete_now) EdgeRuntime.waitUntil(
      (async () => {
        const { error: removeError } = await admin.storage
          .from("instant-media")
          .remove([path]);
        if (!removeError)
          await admin.rpc("finish_media_cleanup", {
            p_bucket: "instant-media",
            p_paths: [path],
          });
      })(),
    );
    return new Response(photo, {
      headers: {
        ...cors,
        "Content-Type": photo.type,
        "Content-Disposition": "inline",
        Pragma: "no-cache",
      },
    });
  } catch {
    return json({ error: "Instant unavailable" }, 400);
  }
});

