"use client";

import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Mode = "signin" | "signup";

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/@chat\.local$/i, "");
}

export default function LoginPage() {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

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
      fail("Incorrect username or password.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function signUp(normalizedUsername: string) {
    if (!supabase) return;

    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: normalizedUsername,
        password,
        inviteCode,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      fail(payload.error ?? "Could not create the account.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: `${normalizedUsername}@chat.local`,
      password,
    });

    if (signInError) {
      setMode("signin");
      setPassword("");
      fail("Account created. Please sign in.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) return;

    const normalizedUsername = normalizeUsername(username);
    const isValidUsername = /^[a-z0-9][a-z0-9._-]{0,31}$/.test(normalizedUsername);

    if (!supabase || !isSupabaseConfigured) {
      fail("Chat is not configured yet.");
      return;
    }

    if (!isValidUsername) {
      fail("Enter a valid username (letters, numbers, . _ -).");
      return;
    }

    if (mode === "signup") {
      const isValidPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(password);

      if (!isValidPassword) {
        fail("Password must be at least 8 characters and include a letter and a number.");
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
    setIsSubmitting(true);

    if (mode === "signin") {
      await signIn(normalizedUsername);
    } else {
      await signUp(normalizedUsername);
    }
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

  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden px-6 pb-[max(2rem,var(--safe-bottom))] pt-[max(2rem,var(--safe-top))]">
      {/* floating orbs */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="animate-float-slow absolute -top-32 left-1/2 size-[26rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255, 106, 136, 0.35), transparent 65%)" }}
        />
        <div
          className="animate-float-slow absolute -bottom-40 -left-24 size-[24rem] rounded-full blur-3xl [animation-delay:-4s]"
          style={{ background: "radial-gradient(circle, rgba(139, 63, 224, 0.35), transparent 65%)" }}
        />
        <div
          className="animate-float-slow absolute -bottom-24 -right-24 size-[22rem] rounded-full blur-3xl [animation-delay:-7s]"
          style={{ background: "radial-gradient(circle, rgba(193, 53, 132, 0.3), transparent 65%)" }}
        />
      </div>

      <div key={shakeKey} className={`relative w-full max-w-[400px] ${error ? "animate-chat-shake" : ""}`}>
        <div className="mb-8 flex flex-col items-center animate-fade-up">
          <div
            className="mb-6 grid size-20 place-items-center rounded-[26px] text-white shadow-[0_20px_50px_rgba(193,53,132,0.4)]"
            style={{ background: "var(--grad-accent)" }}
          >
            <MessageCircle aria-hidden="true" className="size-10" strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text)]">
            <span className="text-gradient">Direct</span>
          </h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
            <ShieldCheck aria-hidden="true" className="size-4 text-[var(--accent-text)]" strokeWidth={1.8} />
            {mode === "signin" ? "Private, real-time, fast" : "A private space for your circle"}
          </p>
        </div>

        <div className="glass rounded-[26px] border border-[var(--border-strong)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.45)] animate-fade-up" style={{ animationDelay: "80ms" }}>
          <div className="mb-4 flex rounded-2xl bg-[var(--panel-2)] p-1">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={`h-10 flex-1 rounded-xl text-sm font-semibold transition ${
                mode === "signin"
                  ? "bg-[var(--panel)] text-[var(--text)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`h-10 flex-1 rounded-xl text-sm font-semibold transition ${
                mode === "signup"
                  ? "bg-[var(--panel)] text-[var(--text)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} aria-label="Authentication" noValidate>
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-2)]">
              <label className="flex h-14 items-center gap-3 px-4">
                <UserRound aria-hidden="true" className="size-[18px] shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
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

              <div className="mx-4 h-px bg-[var(--border)]" />

              <label className="flex h-14 items-center gap-3 px-4">
                <LockKeyhole aria-hidden="true" className="size-[18px] shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  type="password"
                  name="password"
                  placeholder="Password"
                  aria-label="Password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  enterKeyHint="go"
                />
              </label>

              {mode === "signup" && (
                <>
                  <div className="mx-4 h-px bg-[var(--border)]" />
                  <label className="flex h-14 items-center gap-3 px-4">
                    <Sparkles aria-hidden="true" className="size-[18px] shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
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
                </>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-3 text-center text-[13px] font-medium text-[var(--danger)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-accent mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold"
            >
              {isSubmitting ? (
                <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={1.75} />
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : "Create account"}
                  <ArrowRight aria-hidden="true" className="size-[18px]" strokeWidth={2.2} />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-[var(--text-faint)] animate-fade-up" style={{ animationDelay: "160ms" }}>
          Invite-only · Private circles
        </p>
      </div>
    </main>
  );
}
