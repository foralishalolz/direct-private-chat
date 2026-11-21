"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/push";

/** Registers the push service worker once per session. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
