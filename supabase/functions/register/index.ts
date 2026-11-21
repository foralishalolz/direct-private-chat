// supabase/functions/register/index.ts
import { adminClient, cors, json, readJson, publishableRequest } from "../_shared/client.ts";
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!publishableRequest(req)) return json({ error: "Unauthorized" }, 401);
    const { username, password } = await readJson(req);
    if (
      typeof username !== "string" ||
      !/^[a-z0-9_]{3,24}$/.test(username) ||
      typeof password !== "string" ||
      password.length < 10 ||
      password.length > 128
    )
      return json(
        {
          error:
            "Use a valid username and a password of at least 10 characters.",
        },
        400,
      );
    const admin = adminClient();
    // Gateway IP bucketing is backed by a project-wide ceiling, so spoofing a
    // forwarded header cannot bypass the overall registration rate limit.
    const address =
      (req.headers.get("x-forwarded-for") ?? "unknown")
        .split(",")
        .at(-1)
        ?.trim()
        .slice(0, 80) ?? "unknown";
    const { data: allowed, error: rateError } = await admin.rpc(
      "take_signup_slot",
      { p_address: address },
    );
    if (rateError)
      return json(
        { error: "Account creation is temporarily unavailable." },
        503,
      );
    if (!allowed)
      return json({ error: "Too many attempts. Please try again later." }, 429);
    const { error } = await admin.auth.admin.createUser({
      email: `${username}@chat.local`,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (error) {
      if (/already|exists|registered/i.test(error.message))
        return json({ error: "That username is already taken." }, 409);
      if (/password/i.test(error.message))
        return json({ error: "Choose a stronger password." }, 400);
      return json(
        { error: "Account creation is temporarily unavailable." },
        503,
      );
    }
    return json({ created: true }, 201);
  } catch {
    return json({ error: "Could not create this account." }, 400);
  }
});

