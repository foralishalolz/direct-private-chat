import { requireUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  let endpoint = "";
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!endpoint) {
    return Response.json({ error: "Missing endpoint." }, { status: 400 });
  }

  // Scope the delete by user_id so nobody can remove someone else's device.
  const { error } = await auth.admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", auth.user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
