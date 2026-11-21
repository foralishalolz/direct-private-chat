"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Captures the browser install prompt and shows a small pill to install. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("direct-install-dismissed");

    function onBeforeInstall(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }

    if (stored === "1") {
      return;
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (!deferred || dismissed) return null;


  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "dismissed") {
      window.localStorage.setItem("direct-install-dismissed", "1");
    }
    setDeferred(null);
  }

  function handleDismiss() {
    window.localStorage.setItem("direct-install-dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--tabbar-height)+0.75rem)] z-50 mx-auto w-full max-w-md animate-fade-up">
      <div className="glass flex items-center gap-3 rounded-2xl border border-[var(--border-strong)] p-3 shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: "var(--grad-accent)" }}>
          <Download aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">Install Direct</p>
          <p className="text-[12px] leading-tight text-[var(--text-muted)]">Add to your home screen like an app</p>
        </div>
        <button
          type="button"
          onClick={() => void handleInstall()}
          className="btn-accent rounded-full px-4 py-2 text-[13px] font-semibold"
        >
          Install
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--hover)]"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
