"use client";

import { useEffect, useRef, type PointerEvent } from "react";

/** Paint only once per animation frame. React never re-renders during a drag. */
export function useSwipeReply(enabled: boolean, onReply: () => void, cancelPress: () => void) {
  const root = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; offset: number; direction: "pending" | "horizontal" | "vertical" } | null>(null);
  const frame = useRef(0), suppressUntil = useRef(0);
  function paint(offset: number) {
    if (track.current) track.current.style.transform = offset ? `translate3d(${offset}px,0,0)` : "";
    root.current?.style.setProperty("--reply-progress", String(Math.min(1, offset / 58)));
  }
  function reset() {
    cancelAnimationFrame(frame.current); frame.current = 0; gesture.current = null;
    root.current?.classList.remove("reply-swiping", "reply-armed"); paint(0);
  }
  useEffect(() => () => { cancelAnimationFrame(frame.current); }, []);
  function start(event: PointerEvent<HTMLDivElement>) {
    reset();
    if (!enabled || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button,a,audio,video,input,textarea")) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: 0, direction: "pending" };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || current.direction === "vertical") return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) cancelPress();
    if (current.direction === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (dx <= 0 || Math.abs(dy) >= Math.abs(dx) * .8) { current.direction = "vertical"; return; }
      current.direction = "horizontal";
      event.currentTarget.setPointerCapture(event.pointerId);
      root.current?.classList.add("reply-swiping");
    }
    current.offset = Math.max(0, Math.min(78, dx * .72));
    root.current?.classList.toggle("reply-armed", current.offset >= 58);
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) paint(gesture.current.offset); });
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const swiped = current.direction === "horizontal";
    const reply = !cancelled && swiped && current.offset >= 58;
    if (swiped) suppressUntil.current = Date.now() + 500;
    reset(); cancelPress();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (reply) onReply();
  }
  return { root, track, start, move, finish, suppress: () => Date.now() < suppressUntil.current };
}
