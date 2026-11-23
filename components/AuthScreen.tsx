"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, AtSign, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { db, endpoint } from "@/lib/supabase";
import { errorText, usernameEmail } from "@/lib/types";
import { Brand, ErrorNote, IconButton, Spinner } from "./UI";

type Mode = "login" | "register";

export default function AuthScreen({ initialError = "" }: { initialError?: string }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const submitting = useRef(false);
  const loginTab = useRef<HTMLButtonElement>(null);
  const registerTab = useRef<HTMLButtonElement>(null);

  function choose(next: Mode) {
    if (submitting.current) return;
    setMode(next);
    setError("");
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "login" : event.key === "End" ? "register" : mode === "login" ? "register" : "login";
    choose(next);
    (next === "login" ? loginTab : registerTab).current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const email = usernameEmail(username);
      if (mode === "register") {
        await endpoint("register", { username: email.split("@")[0], password }, false);
      }
      const result = await db().auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-glow" aria-hidden="true" /><div className="auth-glass-orb" aria-hidden="true" />
      <section className="auth-card" aria-label="BitchAt account">
        <Brand />
        <form onSubmit={submit} className="auth-form" aria-busy={busy}>
          <div className="auth-tabs" role="tablist" aria-label="Account">
            <button ref={loginTab} id="login-tab" type="button" role="tab" aria-selected={mode === "login"} aria-controls="auth-fields" tabIndex={mode === "login" ? 0 : -1} disabled={busy} onKeyDown={tabKey} onClick={() => choose("login")}>Log in</button>
            <button ref={registerTab} id="register-tab" type="button" role="tab" aria-selected={mode === "register"} aria-controls="auth-fields" tabIndex={mode === "register" ? 0 : -1} disabled={busy} onKeyDown={tabKey} onClick={() => choose("register")}>Create account</button>
          </div>
          <div id="auth-fields" className="auth-fields" role="tabpanel" aria-labelledby={mode === "login" ? "login-tab" : "register-tab"}>
            <label className="input-icon">
              <AtSign size={19} aria-hidden="true" />
              <input name="username" aria-label="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Username" required minLength={3} maxLength={25} pattern="@?[A-Za-z0-9_]{3,24}" disabled={busy} value={username} onChange={event => setUsername(event.target.value)} />
            </label>
            <label className="input-icon">
              <LockKeyhole size={19} aria-hidden="true" />
              <input name="password" aria-label="Password" autoComplete={mode === "login" ? "current-password" : "new-password"} type={show ? "text" : "password"} placeholder="Password" required minLength={mode === "register" ? 10 : 1} maxLength={128} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
              <IconButton label={show ? "Hide password" : "Show password"} onClick={() => setShow(value => !value)}>{show ? <EyeOff size={19} /> : <Eye size={19} />}</IconButton>
            </label>
            <ErrorNote text={error} />
            <button className="primary auth-submit" disabled={busy} aria-label={mode === "login" ? "Log in" : "Create account"}>
              {busy ? <Spinner /> : <><span>{mode === "login" ? "Log in" : "Create account"}</span><ArrowRight size={19} /></>}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
