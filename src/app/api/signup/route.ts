import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SignupPayload {
  username?: unknown;
  password?: unknown;
  inviteCode?: unknown;
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

// At least one letter and one number, 8+ characters.
const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;

// Best-effort in-memory rate limit: 5 accounts per hour per IP. Resets on
// server restart / cold start, and is per-instance on platforms that run
// multiple serverless instances (e.g. Vercel) — it slows down a single bot
// on a single instance, it does not replace a real rate limiter like
// Upstash Redis for a large deployment. The admin is exempt because
// accounts created from the admin dashboard don't go through this route.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const attemptsByIp = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attemptsByIp.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

function normalizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/@chat\.local$/i, "");
}

export async function POST(request: Request) {
  const admin = getSupabaseAdmin();

  if (!admin) {
    return Response.json(
      { error: "Account creation is not configured." },
      { status: 503 },
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  let body: SignupPayload;
  try {
    body = (await request.json()) as SignupPayload;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const rawUsername = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const inviteCode =
    typeof body.inviteCode === "string" ? body.inviteCode : "";
  const username = normalizeUsername(rawUsername);

  const requiredInviteCode = process.env.SIGNUP_INVITE_CODE;
  if (requiredInviteCode && inviteCode !== requiredInviteCode) {
    return Response.json(
      { error: "Invalid invite code." },
      { status: 403 },
    );
  }

  if (!USERNAME_PATTERN.test(username)) {
    return Response.json(
      {
        error:
          "Username must be 1–32 characters using letters, numbers, dots, dashes or underscores.",
      },
      { status: 400 },
    );
  }

  if (!PASSWORD_PATTERN.test(password)) {
    return Response.json(
      {
        error:
          "Password must be at least 8 characters and include a letter and a number.",
      },
      { status: 400 },
    );
  }

  const email = `${username}@chat.local`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });

  if (error) {
    const message = error.message.toLowerCase();
    const alreadyExists =
      message.includes("already") ||
      message.includes("registered") ||
      message.includes("exists") ||
      error.status === 422;

    return Response.json(
      {
        error: alreadyExists
          ? "That username is already taken."
          : "Could not create the account. Try again.",
      },
      { status: alreadyExists ? 409 : 400 },
    );
  }

  if (!data.user) {
    return Response.json(
      { error: "Could not create the account. Try again." },
      { status: 400 },
    );
  }

  return Response.json({ ok: true, username }, { status: 201 });
}
