// supabase/functions/media-cleanup/index.ts
import { adminClient } from "../_shared/client.ts";
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const secret = req.headers.get("x-cleanup-secret");
    if (!secret || !/^[a-f0-9]{64}$/.test(secret))
      return new Response(null, { status: 401 });
    const admin = adminClient();
    const { data: authorized, error: authError } = await admin.rpc(
      "authorize_cleanup",
      { p_secret: secret },
    );
    if (authError || !authorized) return new Response(null, { status: 401 });
    let deleted = 0;
    let failures = 0;
    for (let round = 0; round < 10; round++) {
      const { data: jobs, error } = await admin.rpc("get_media_cleanup_batch");
      if (error) throw error;
      if (!jobs?.length) break;
      const buckets = new Map<string, string[]>();
      for (const job of jobs) {
        const group = buckets.get(job.bucket_id) ?? [];
        group.push(job.object_path);
        buckets.set(job.bucket_id, group);
      }
      for (const [bucket, paths] of buckets) {
        const { error: removeError } = await admin.storage
          .from(bucket)
          .remove(paths);
        const { error: finishError } = await admin.rpc("finish_media_cleanup", {
          p_bucket: bucket,
          p_paths: paths,
          p_error: removeError?.message ?? null,
        });
        if (removeError || finishError) failures += paths.length;
        else deleted += paths.length;
      }
      if (failures) break;
    }
    return Response.json(
      { deleted, failures },
      {
        status: failures ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Cleanup failed; queued files will be retried." },
      { status: 500 },
    );
  }
});
