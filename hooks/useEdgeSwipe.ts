"use client";
import { useEffect } from "react";

/**
 * Native-style "swipe from the left edge to go back".
 *
 * Only fires when the gesture starts inside the left gutter (28px), so it never
 * fights the message swipe-to-reply or a horizontal carousel. Ignores scrolls
 * that are mostly vertical.
 */
export function useEdgeSwipe(onBack: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let start: { x: number; y: number; id: number; armed: boolean } | null = null;
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId, armed: event.clientX < 34 };
    };
    const up = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) { start = null; return; }
      const dx = event.clientX - start.x, dy = Math.abs(event.clientY - start.y);
      if (start.armed && dx > 72 && dy < 70) {
        try { navigator.vibrate?.(6); } catch {}
        onBack();
      }
      start = null;
    };
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointercancel", () => { start = null; }, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
    };
  }, [onBack, enabled]);
}
