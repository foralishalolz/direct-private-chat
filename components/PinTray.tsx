"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Pin as PinIcon, X } from "lucide-react";
import type { Pin } from "@/hooks/usePins";
import { label } from "@/lib/types";
import { Avatar, IconButton } from "./UI";

/**
 * Telegram-style pinned bar: one line visible, swipe through the rest, opens
 * the full tray. Collapses entirely when nothing is pinned.
 */
export default function PinTray({ pins, onJump, onUnpin }: { pins: Pin[]; onJump: (messageId: string) => void; onUnpin: (messageId: string) => Promise<void> }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  if (!pins.length) return null;
  const safe = Math.min(index, pins.length - 1);
  const pin = pins[safe];
  const preview = pin.content || (pin.kind === "sticker" ? "Sticker" : pin.media_kind === "video" ? "Video" : pin.media_kind === "audio" ? "Voice note" : "Photo");

  if (open) return <section className="pin-sheet" aria-label="Pinned messages">
    <header><h3><PinIcon size={16}/>Pinned</h3><span>{pins.length}</span><IconButton label="Close pins" onClick={() => setOpen(false)}><X size={18}/></IconButton></header>
    <div className="pin-list">{pins.map(item => <article key={item.message_id} className="pin-item">
      <button className="pin-jump" onClick={() => { onJump(item.message_id); setOpen(false); }}>
        <Avatar profile={item.author} size={30}/>
        <span><strong>{label(item.author)}</strong><p>{item.content || (item.media_kind === "image" ? <><ImageIcon size={12}/> Photo</> : "Attachment")}</p></span>
      </button>
      <IconButton label="Unpin message" onClick={() => void onUnpin(item.message_id)}><X size={15}/></IconButton>
    </article>)}</div>
  </section>;

  return <div className="pin-bar">
    <button className="pin-main" onClick={() => onJump(pin.message_id)} aria-label="Jump to pinned message">
      <span className="pin-glyph" aria-hidden="true"><PinIcon size={14}/></span>
      <span><small>Pinned · {label(pin.author)}</small><p>{preview}</p></span>
    </button>
    {pins.length > 1 && <span className="pin-nav">
      <IconButton label="Previous pin" onClick={() => setIndex((safe - 1 + pins.length) % pins.length)}><ChevronLeft size={16}/></IconButton>
      <small>{safe + 1}/{pins.length}</small>
      <IconButton label="Next pin" onClick={() => setIndex((safe + 1) % pins.length)}><ChevronRight size={16}/></IconButton>
    </span>}
    <IconButton label="Show all pins" onClick={() => setOpen(true)}><PinIcon size={15}/></IconButton>
  </div>;
}
