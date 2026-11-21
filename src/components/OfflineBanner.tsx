"use client";

import { RefreshCw, WifiOff, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

/**
 * Thin status strip. Shows "reconnecting" while offline, and a subtle
 * "slow connection" hint on 2G while still allowing full use — messages are
 * queued and delivered when the link catches up.
 */
export function OfflineBanner({
  online,
  slow,
}: {
  online?: boolean;
  slow?: boolean;
}) {
  const status = useNetworkStatus();
  const isOnline = online ?? status.online;
  const isSlow = slow ?? status.slow;
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    if (isOnline) return;
    let cancelled = false;

    const onOnline = () => {
      if (cancelled) return;
      setShowBackOnline(true);
      setTimeout(() => setShowBackOnline(false), 2200);
    };
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [isOnline]);

  if (isOnline && !isSlow && !showBackOnline) return null;

  const offline = !isOnline;

  return (
    <div
      role="status"
      className={`fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 px-4 py-1.5 text-[11.5px] font-semibold tracking-tight safe-top backdrop-blur ${
        offline
          ? "bg-[var(--warning)]/18 text-[var(--warning)]"
          : "bg-[var(--info)]/14 text-[var(--info)]"
      }`}
    >
      {offline ? (
        <>
          <WifiOff className="size-3.5" strokeWidth={2.4} />
          Offline · messages will send when you&apos;re back
          <RefreshCw className="size-3 animate-spin" strokeWidth={2.6} />
        </>
      ) : (
        <>
          <Zap className="size-3.5" strokeWidth={2.4} />
          {showBackOnline ? "Back online" : "Slow connection — sending optimistically"}
        </>
      )}
    </div>
  );
}
