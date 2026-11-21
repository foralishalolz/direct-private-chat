"use client";

import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import { currentPermission, isSubscribed, pushSupported, subscribeToPush } from "@/lib/push";

/**
 * A single, dismissible nudge to enable push. Shown only when notifications
 * are actually available and not yet enabled, so it never nags people whose
 * browser can't support it.
 */
export function PushPromptCard() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (!pushSupported()) return;
      if (localStorage.getItem("bitchat-push-prompt-dismissed") === "1") return;
      if (localStorage.getItem("bitchat-push-enabled") === "1") return;
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
      if (currentPermission() === "denied") return;

      const subscribed = await isSubscribed();
      if (!cancelled) setVisible(!subscribed);
    }

    const timer = setTimeout(() => void evaluate(), 1600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    const result = await subscribeToPush();
    setBusy(false);
    if (result.ok) {
      setVisible(false);
    } else {
      setError(result.reason);
    }
  }

  function dismiss() {
    localStorage.setItem("bitchat-push-prompt-dismissed", "1");
    setVisible(false);
  }

  return (
    <div className="animate-fade-up mb-3 overflow-hidden rounded-2xl border border-[var(--accent)]/25 bg-gradient-to-br from-[var(--accent)]/14 via-[var(--accent-2)]/10 to-transparent p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl accent-gradient text-white">
          <BellRing className="size-[18px]" strokeWidth={2.1} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-snug text-[var(--text)]">
            Never miss a message
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
            {error ??
              "Turn on notifications to catch late-night texts and plan reminders."}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void enable()}
              disabled={busy}
              className="press h-8 rounded-full accent-gradient px-3.5 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Turning on…" : "Turn on"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="press h-8 rounded-full px-3 text-[12.5px] font-semibold text-[var(--text-muted)]"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="press -mr-1 -mt-1 grid size-7 place-items-center rounded-full text-[var(--text-faint)]"
        >
          <X className="size-3.5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
