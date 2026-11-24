"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * iOS-style tab bar state: scroll up hides the bar, scrolling back down shows
 * it, and it always reappears at the top of the list. Pure state, no DOM reads
 * inside render.
 */
export function useTabBar(threshold = 24) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  const reset = useCallback(() => { setHidden(false); last.current = 0; }, []);
  const onScroll = useCallback((event: { currentTarget: EventTarget | null }) => {
    const node = event.currentTarget as HTMLElement | null;
    if (!node) return;
    const top = node.scrollTop;
    if (top <= 8) { setHidden(false); last.current = top; return; }
    const delta = top - last.current;
    if (Math.abs(delta) < threshold) return;
    setHidden(delta > 0);
    last.current = top;
  }, [threshold]);
  return { hidden, onScroll, reset };
}

/** Press feedback class for anything that should feel tactile on touch. */
export function usePressFeedback() {
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("button, [role='button'], .conversation, .rail-profile");
      if (!target) return;
      target.classList.add("pressed");
    };
    const up = () => {
      document.querySelectorAll(".pressed").forEach(node => node.classList.remove("pressed"));
    };
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointercancel", up, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, []);
}
