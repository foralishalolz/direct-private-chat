"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Pull-to-refresh for the inbox on touch devices, with a rubber-band ceiling so
 * it feels like a native scroll view instead of a page bounce.
 */
export function usePullRefresh(onRefresh: () => Promise<unknown>, selector = ".conversation-list", max = 92) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const origin = useRef<{ y: number; atTop: boolean } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const area = document.querySelector(selector) as HTMLElement | null;
    const scroller = (area?.closest(".inbox") as HTMLElement | null) ?? area;
    if (!scroller) return;
    const touch = (event: TouchEvent) => event.touches[0];
    const start = (event: TouchEvent) => {
      if (busyRef.current || event.touches.length !== 1) return;
      origin.current = { y: touch(event).clientY, atTop: scroller.scrollTop <= 0 };
    };
    const move = (event: TouchEvent) => {
      if (!origin.current?.atTop || busyRef.current) return;
      const delta = touch(event).clientY - origin.current.y;
      if (delta <= 0) { setPull(0); return; }
      // Resist: 1px of finger becomes at most ~0.55px of movement.
      const eased = Math.min(max, Math.pow(delta, 0.86) * 1.9);
      if (eased > 6) { event.preventDefault(); setPull(eased); }
    };
    const end = async () => {
      if (!origin.current) return;
      const distance = pull;
      origin.current = null;
      if (distance < 58 || busyRef.current) { setPull(0); return; }
      busyRef.current = true; setBusy(true); setPull(56);
      try { await onRefresh(); } finally {
        busyRef.current = false; setBusy(false); setPull(0);
      }
    };
    scroller.addEventListener("touchstart", start, { passive: true });
    scroller.addEventListener("touchmove", move, { passive: false });
    scroller.addEventListener("touchend", () => void end());
    scroller.addEventListener("touchcancel", () => { origin.current = null; setPull(0); });
    return () => {
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
    };
  }, [onRefresh, selector, max, pull]);

  return { pull, busy };
}
