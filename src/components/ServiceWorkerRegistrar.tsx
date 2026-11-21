"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once on first paint. Kept deliberately tiny —
 * everything else (push opt-in, offline banner) lives in its own component so
 * this never blocks the app shell from rendering.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* Swallowed: app still works without offline support. */
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
