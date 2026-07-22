"use client";

import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
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
      const payload = (await response
        .json()
        .catch(() => ({}))) as { error?: string };
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
    const isValidUsername = /^[a-z0-9][a-z0-9._-]{0,31}$/.test(
      normalizedUsername,
    );

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
        fail(
          "Password must be at least 8 characters and include a letter and a number.",
        );
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
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-[var(--tg-bg)] px-6 pb-[max(2rem,var(--safe-bottom))] pt-[max(2rem,var(--safe-top))]">
      <div
        key={shakeKey}
        className={`w-full max-w-[360px] ${error ? "animate-chat-shake" : ""}`}
      >
        <div className="mb-10 flex flex-col items-center">
          <div className="mb-5 grid size-16 place-items-center rounded-3xl bg-[var(--tg-accent)] shadow-[0_16px_40px_rgba(46,166,255,0.28)]">
            <MessageCircle
              aria-hidden="true"
              className="size-8 text-white"
              strokeWidth={2}
            />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--tg-text)]">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-[var(--tg-text-muted)]">
            {mode === "signin"
              ? "Sign in to continue"
              : "Pick a username and password"}
          </p>
        </div>

        <div className="mb-4 flex rounded-2xl bg-[var(--tg-panel-2)] p-1">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`h-9 flex-1 rounded-xl text-sm font-medium transition ${
              mode === "signin"
                ? "bg-[var(--tg-panel)] text-[var(--tg-text)] shadow-sm"
                : "text-[var(--tg-text-muted)]"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`h-9 flex-1 rounded-xl text-sm font-medium transition ${
              mode === "signup"
                ? "bg-[var(--tg-panel)] text-[var(--tg-text)] shadow-sm"
                : "text-[var(--tg-text-muted)]"
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} aria-label="Authentication" noValidate>
          <div className="overflow-hidden rounded-[18px] border border-[var(--tg-border)] bg-[var(--tg-panel)]">
            <label className="flex h-14 items-center gap-3 px-4">
              <UserRound
                aria-hidden="true"
                className="size-[18px] shrink-0 text-[var(--tg-text-muted)]"
                strokeWidth={1.75}
              />
              <input
                ref={usernameRef}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-muted)]"
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

            <div className="mx-4 h-px bg-[var(--tg-panel-2)]" />

            <label className="flex h-14 items-center gap-3 px-4">
              <LockKeyhole
                aria-hidden="true"
                className="size-[18px] shrink-0 text-[var(--tg-text-muted)]"
                strokeWidth={1.75}
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-muted)]"
                type="password"
                name="password"
                placeholder="Password"
                aria-label="Password"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                enterKeyHint="go"
              />
            </label>

            {mode === "signup" && (
              <>
                <div className="mx-4 h-px bg-[var(--tg-panel-2)]" />
                <label className="flex h-14 items-center gap-3 px-4">
                  <LockKeyhole
                    aria-hidden="true"
                    className="size-[18px] shrink-0 text-[var(--tg-text-muted)]"
                    strokeWidth={1.75}
                  />
                  <input
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-muted)]"
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
            <p
              role="alert"
              className="mt-3 text-center text-[13px] font-medium text-[var(--tg-danger)]"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--tg-accent)] text-[15px] font-semibold text-white transition duration-200 hover:bg-[var(--tg-accent-strong)] active:scale-[0.99] disabled:cursor-default disabled:bg-[var(--tg-panel-2)] disabled:text-[var(--tg-text-muted)]"
          >
            {isSubmitting ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin"
                strokeWidth={1.75}
              />
            ) : (
              <>
                {mode === "signin" ? "Sign in" : "Create account"}
                <ArrowRight
                  aria-hidden="true"
                  className="size-[18px]"
                  strokeWidth={2}
                />
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
