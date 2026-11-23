"use client";

import { useState } from "react";
import { haptic } from "@/lib/haptics";
import { COMFORTS, FEELINGS, KISSES } from "@/lib/couple";
import { errorText, label, type Conversation } from "@/lib/types";
import { ErrorNote, Modal } from "./UI";

/**
 * Moods, comfort and kisses in one sheet. Everything lands as a normal message
 * so the partner gets the push notification, the preview and the reply thread
 * they already understand.
 */
export default function FeelsSheet({ c, tab, onClose, onSend }: { c: Conversation; tab: "feels" | "kiss" | "comfort"; onClose: () => void; onSend: (line: string, kind?: "message" | "miss") => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"feels" | "kiss" | "comfort" | "family">(tab);
  const partner = label(c.partner) || "them";

  async function send(line: string, key: string) {
    if (busy) return;
    setBusy(key); setError(""); haptic("success");
    try {
      await onSend(line);
      onClose();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(""); }
  }

  const tabs = [
    ["feels", "Mood", "🌧️"],
    ["comfort", "Comfort", "🫂"],
    ["kiss", "Kisses", "💋"],
    ["family", "Future", "🌱"],
  ] as const;

  return <Modal title="How are you?" onClose={onClose} wide>
    <div className="panel-pad feels">
      <div className="feels-tabs" role="tablist">{tabs.map(([id, text, glyph]) => <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}><span aria-hidden="true">{glyph}</span>{text}</button>)}</div>

      {mode === "feels" && <>
        <p className="muted">Say it without typing. {partner} gets a message and a notification.</p>
        <div className="feels-grid">{FEELINGS.map(item => <button key={item.id} disabled={!!busy} aria-label={item.label} onClick={() => void send(item.line, item.id)}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}</div>
      </>}

      {mode === "comfort" && <>
        <p className="muted">For the days that are too heavy. Short, warm, no advice unless it is asked for.</p>
        <div className="comfort-list">{COMFORTS.map(item => <button key={item.id} disabled={!!busy} onClick={() => void send(item.line, item.id)}><span aria-hidden="true">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.line.replace(/^\S+\s/, "")}</small></span></button>)}</div>
      </>}

      {mode === "kiss" && <>
        <p className="muted">Digital kisses. Pick a spot.</p>
        <div className="kiss-list">{KISSES.map(item => <button key={item.id} disabled={!!busy} onClick={() => void send(item.line, item.id)}><span aria-hidden="true">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.line.replace(/^\S+\s/, "")}</small></span></button>)}</div>
      </>}

      {mode === "family" && <>
        <p className="muted">Dream together, at your own pace. Tap a question to share it.</p>
        <div className="comfort-list">{["What baby names do you love?", "What would our future home feel like?", "What traditions would we make together?", "What would we want to teach a child?", "What does family mean to you?", "What adventure would our future family go on?"].map(line => <button key={line} disabled={!!busy} onClick={() => void send("🌱 " + line, line)}><span aria-hidden="true">🌱</span><strong>{line}</strong></button>)}</div>
      </>}
      <ErrorNote text={error}/>
    </div>
  </Modal>;
}
