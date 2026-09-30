"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { time, title, type Conversation } from "@/lib/types";
import { Avatar, Spinner } from "./UI";

const REVEAL = 144;

export default function SwipeChat({ conversation, selected, open, busy, onReveal, onOpen, onArchive, onDelete }: {
  conversation: Conversation;
  selected: boolean;
  open: boolean;
  busy: boolean;
  onReveal: (id: string | null) => void;
  onOpen: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; base: number; offset: number; direction: "pending" | "horizontal" | "vertical" } | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef(0);
  const actionsId = "chat-actions-" + conversation.id;

  function paint(offset: number) {
    if (track.current) track.current.style.transform = `translate3d(${offset}px,0,0)`;
  }

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    gesture.current = null;
    root.current?.classList.remove("swiping");
    paint(open ? -REVEAL : 0);
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onReveal(null);
    };
    document.addEventListener("pointerdown", outside, { passive: true });
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onReveal]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (busy || !event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base: open ? -REVEAL : 0, offset: open ? -REVEAL : 0, direction: "pending" };
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || current.direction === "vertical") return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.direction === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 9) return;
      if (Math.abs(dy) >= Math.abs(dx) * .8 || !open && dx > 0) {
        current.direction = "vertical";
        suppressClick.current = true;
        return;
      }
      current.direction = "horizontal";
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      root.current?.classList.add("swiping");
    }
    current.offset = Math.max(-REVEAL, Math.min(0, current.base + dx));
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) paint(gesture.current.offset); });
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    cancelAnimationFrame(frame.current); frame.current = 0;
    gesture.current = null;
    root.current?.classList.remove("swiping");
    const reveal = cancelled ? open : current.direction === "horizontal" ? current.offset < -REVEAL / 3 : open;
    paint(reveal ? -REVEAL : 0);
    if (current.direction === "horizontal") onReveal(reveal ? conversation.id : null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div ref={root} className={"conversation-item" + (open ? " actions-open" : "")} onKeyDown={event => {
    if (open && (event.key === "Escape" || event.key === "ArrowRight")) { event.preventDefault(); onReveal(null); track.current?.focus(); }
  }} onBlur={event => {
    if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onReveal(null);
  }}>
    <div id={actionsId} className="conversation-actions" aria-hidden={!open}>
      <button type="button" className="chat-archive-action" tabIndex={open ? 0 : -1} disabled={busy} aria-label={(conversation.archived ? "Unarchive" : "Archive") + " chat with " + title(conversation)} onClick={() => onArchive(conversation.id, !conversation.archived)}>
        {busy ? <Spinner /> : conversation.archived ? <ArchiveRestore size={20} /> : <Archive size={20} />}<span>{conversation.archived ? "Unarchive" : "Archive"}</span>
      </button>
      <button type="button" className="chat-delete-action" tabIndex={open ? 0 : -1} disabled={busy} aria-label={"Delete chat with " + title(conversation)} onClick={() => { onReveal(null); onDelete(conversation.id); }}><Trash2 size={20} /><span>Delete</span></button>
    </div>
    <button ref={track} type="button" className={"conversation" + (selected ? " selected" : "")} aria-expanded={open} aria-controls={actionsId}
      onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onContextMenu={event => { event.preventDefault(); if (!busy) onReveal(conversation.id); }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onReveal(conversation.id); }
        if (event.key === "ArrowRight" || event.key === "Escape") { event.preventDefault(); onReveal(null); }
      }}
      onClick={event => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        if (open) onReveal(null); else onOpen(conversation.id);
      }}>
      <span className="avatar-wrap"><Avatar profile={conversation.partner} group={conversation.kind === "group"} size={49} />{conversation.partner?.mood && <span className="mood-badge">{conversation.partner.mood}</span>}</span>
      <span className="conversation-copy">
        <span className="row"><strong>{title(conversation)}</strong><small className="push">{time(conversation.last_activity)}</small></span>
        <span className="row"><span className={"preview" + (conversation.unread ? " unread" : "")}>{conversation.preview || (conversation.kind === "group" ? String(conversation.members?.length ?? 0) + " members" : "@" + (conversation.partner?.username ?? ""))}</span>{conversation.unread && <i className="unread-dot" />}</span>
      </span>
    </button>
  </div>;
}
