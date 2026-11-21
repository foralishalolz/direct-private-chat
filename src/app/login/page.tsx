"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { primeAudio } from "@/lib/sound";

type Mode = "signin" | "signup";

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/@chat\.local$/i, "");
}

const FLOATERS = [
  { emoji: "💗", left: "8%", delay: "0s", size: "28px" },
  { emoji: "✨", left: "24%", delay: "1.4s", size: "20px" },
  { emoji: "💌", left: "62%", delay: "0.7s", size: "24px" },
  { emoji: "🌙", left: "82%", delay: "2.1s", size: "22px" },
  { emoji: "💞", left: "44%", delay: "2.9s", size: "18px" },
];

export default function LoginPage() {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [justCreated, setJustCreated] = useState(false);

  useEffect(() => {
    usernameRef.current?.focus({ preventScroll: true });
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  function fail(message: string) {
    setError(message);
    setShakeKey((key) => key + 1);
    setIsSubmitting(false);
  }

  async function signIn(normalizedUsername: string) {
    if (!supabase) return;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: `${normalizedUsername}@chat.local`,
      password,
    });

    if (signInError) {
      setPassword("");
      fail(
        signInError.message.toLowerCase().includes("invalid")
          ? "That username and password don't match."
          : "Couldn't sign you in. Check your connection and try again.",
      );
      return;
    }

    primeAudio();
    router.replace("/");
    router.refresh();
  }

  async function signUp(normalizedUsername: string) {
    if (!supabase) return;

    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: normalizedUsername, password, inviteCode }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      fail(payload.error ?? "Could not create the account.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: `${normalizedUsername}@chat.local`,
      password,
    });

    if (signInError) {
      setMode("signin");
      setJustCreated(true);
      setPassword("");
      fail("Account created — sign in to continue.");
      return;
    }

    primeAudio();
    router.replace("/");
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedUsername = normalizeUsername(username);
    const isValidUsername = /^[a-z0-9][a-z0-9._-]{0,31}$/.test(normalizedUsername);

    if (!supabase || !isSupabaseConfigured) {
      fail("Chat isn't configured yet. Add your Supabase keys and redeploy.");
      return;
    }

    if (!isValidUsername) {
      fail("Usernames use letters, numbers, dots, dashes or underscores.");
      return;
    }

    if (mode === "signup") {
      const isValidPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(password);
      if (!isValidPassword) {
        fail("Password needs 8+ characters with at least one letter and number.");
        return;
      }
      if (inviteCode.trim().length === 0) {
        fail("Enter your invite code.");
        return;
      }
    } else if (password.length === 0) {
      fail("Enter your password.");
      return;
    }

    setError(null);
    setJustCreated(false);
    setIsSubmitting(true);
    if (mode === "signin") await signIn(normalizedUsername);
    else await signUp(normalizedUsername);
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    setPassword("");
    setInviteCode("");
    usernameRef.current?.focus({ preventScroll: true });
  }

  const canSubmit =
    username.trim().length > 0 &&
    password.length > 0 &&
    (mode === "signin" || inviteCode.trim().length > 0) &&
    !isSubmitting;

  if (!isSupabaseConfigured) {
    return (
      <main className="hero-bg relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden px-6">
        <div className="w-full max-w-[400px] rounded-[26px] border border-[var(--border)] bg-[var(--panel)]/80 p-6 text-center backdrop-blur">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl accent-gradient shadow-[0_16px_40px_-18px_var(--accent-glow)]">
            <Heart className="size-7 fill-white text-white" strokeWidth={1.5} />
          </div>
          <h1 className="accent-text mt-4 text-[24px] font-extrabold tracking-tight">
            BitchAt
          </h1>
          <p className="mt-1 text-[13.5px] font-medium text-[var(--text-soft)]">
            One step left — connect your Supabase project.
          </p>
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-left text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            <p className="font-semibold text-[var(--text-soft)]">
              Add these in your host&apos;s environment variables:
            </p>
            <code className="mt-1.5 block whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-[var(--accent)]">
              NEXT_PUBLIC_SUPABASE_URL
              {"\n"}NEXT_PUBLIC_SUPABASE_ANON_KEY
              {"\n"}SUPABASE_SERVICE_ROLE_KEY
              {"\n"}SIGNUP_INVITE_CODE
            </code>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Then run <span className="font-mono">supabase/setup.sql</span> in the
            Supabase SQL editor and redeploy. See{" "}
            <span className="font-mono">DEPLOYMENT.md</span> for the full walkthrough.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="hero-bg relative flex min-h-dvh w-full flex-col overflow-hidden">
      {/* Floating ambient hearts */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {FLOATERS.map((floater) => (
          <span
            key={floater.emoji + floater.left}
            className="absolute bottom-24 select-none opacity-0"
            style={{
              left: floater.left,
              fontSize: floater.size,
              animation: `float-heart 7s ease-in-out ${floater.delay} infinite`,
            }}
          >
            {floater.emoji}
          </span>
        ))}
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 pb-[max(2rem,var(--safe-bottom))] pt-[max(3rem,var(--safe-top))]">
        <div key={shakeKey} className={error ? "animate-chat-shake" : ""}>
          <div className="mb-9 flex flex-col items-center text-center">
            <div className="relative mb-5">
              <div className="absolute inset-0 animate-pulse-ring rounded-[26px]" />
              <div className="relative grid size-[68px] place-items-center rounded-[26px] accent-gradient shadow-[0_20px_50px_-16px_rgba(244,114,182,0.7)]">
                <Heart className="size-8 fill-white text-white" strokeWidth={1.5} />
              </div>
            </div>
            <h1 className="accent-text text-[30px] font-extrabold leading-tight tracking-tight">
              BitchAt
            </h1>
            <p className="mt-2 max-w-[16rem] text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              {mode === "signin"
                ? "Your private little corner of the internet."
                : "Just you and your people. Create your account to begin."}
            </p>
          </div>

          <div className="mb-5 flex rounded-2xl border border-[var(--border)] bg-[var(--panel)]/70 p-1 backdrop-blur">
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Create account"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={`h-10 flex-1 rounded-xl text-[13.5px] font-semibold transition-all ${
                  mode === value
                    ? "bg-[var(--panel-3)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-faint)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            <label className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/80 px-4 backdrop-blur transition focus-within:border-[var(--accent)]/60">
              <UserRound
                aria-hidden="true"
                className="size-[18px] shrink-0 text-[var(--text-faint)]"
                strokeWidth={1.8}
              />
              <input
                ref={usernameRef}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                type="text"
                name="username"
                placeholder="Username"
                aria-label="Username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                spellCheck={false}
                maxLength={32}
              />
            </label>

            <label className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/80 px-4 backdrop-blur transition focus-within:border-[var(--accent)]/60">
              <LockKeyhole
                aria-hidden="true"
                className="size-[18px] shrink-0 text-[var(--text-faint)]"
                strokeWidth={1.8}
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Password"
                aria-label="Password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                enterKeyHint={mode === "signin" ? "go" : "next"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="shrink-0 text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
              >
                {showPassword ? (
                  <EyeOff className="size-[18px]" strokeWidth={1.8} />
                ) : (
                  <Eye className="size-[18px]" strokeWidth={1.8} />
                )}
              </button>
            </label>

            {mode === "signup" && (
              <label className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/80 px-4 backdrop-blur transition focus-within:border-[var(--accent)]/60">
                <KeyRound
                  aria-hidden="true"
                  className="size-[18px] shrink-0 text-[var(--text-faint)]"
                  strokeWidth={1.8}
                />
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  type="text"
                  name="inviteCode"
                  placeholder="Invite code"
                  aria-label="Invite code"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  enterKeyHint="go"
                  spellCheck={false}
                />
              </label>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-3.5 py-2.5 text-[13px] font-medium leading-snug text-[var(--danger)]"
              >
                {error}
              </p>
            )}

            {justCreated && !error && (
              <p className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/10 px-3.5 py-2.5 text-[13px] font-medium text-[var(--success)]">
                Account created. You can sign in now.
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="press mt-2 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl accent-gradient text-[15px] font-bold text-white shadow-[0_16px_40px_-18px_var(--accent-glow)] transition hover:brightness-110 disabled:opacity-40"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-5 animate-spin" strokeWidth={2} />
              ) : (
                <>
                  {mode === "signin" ? "Enter BitchAt" : "Create my account"}
                  <ArrowRight className="size-[18px]" strokeWidth={2.4} />
                </>
              )}
            </button>
          </form>

          {mode === "signup" && (
            <p className="mt-4 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-[var(--text-faint)]">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
              The very first account on a fresh setup becomes the admin. Invite
              codes keep strangers out.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
