"use client";

import { useState } from "react";
import { haptic } from "@/lib/haptics";
import { COMFORTS, FEELINGS, KISSES } from "@/lib/couple";
import { errorText, type Conversation } from "@/lib/types";
import { ErrorNote, Modal } from "./UI";

export default function FeelsSheet({ tab, onClose, onSend }: { c: Conversation; tab: "feels" | "kiss" | "comfort"; onClose: () => void; onSend: (line: string, kind?: "message" | "miss") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<"feels" | "kiss" | "comfort" | "family">(tab);

  function choose(line: string) { setDraft(line); setError(""); haptic("light"); }
  async function send() {
    if (busy || !draft?.trim()) return;
    setBusy(true); setError("");
    try { await onSend(draft.trim()); haptic("success"); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const tabs = [["feels", "Mood", "🌧️"], ["comfort", "Comfort", "🫂"], ["kiss", "Kisses", "💋"], ["family", "Future", "🌱"]] as const;
  return <Modal title="Feels" onClose={onClose} wide>
    <div className="panel-pad feels">
      {draft !== null ? <div className="feels-draft">
        <p>Make it yours</p>
        <textarea autoFocus aria-label="Edit message" maxLength={4000} rows={4} value={draft} onChange={event => setDraft(event.target.value)}/>
        <div className="feels-draft-actions"><button disabled={busy} onClick={() => setDraft(null)}>Back</button><button className="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</button></div>
      </div> : <>
        <div className="feels-tabs" role="tablist" aria-label="Feels categories">{tabs.map(([id, text, glyph]) => <button key={id} role="tab" aria-selected={mode === id} onClick={() => { setMode(id); haptic("light"); }}><span aria-hidden="true">{glyph}</span>{text}</button>)}</div>
        {mode === "feels" && <><p className="muted">How are you feeling?</p><div className="feels-grid">{FEELINGS.map(item => <button key={item.id} aria-label={item.label} onClick={() => choose(item.line)}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}</div></>}
        {mode === "comfort" && <><p className="muted">Send a little comfort.</p><div className="comfort-list">{COMFORTS.map(item => <button key={item.id} onClick={() => choose(item.line)}><span aria-hidden="true">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.line.replace(/^\S+\s/, "")}</small></span></button>)}</div></>}
        {mode === "kiss" && <><p className="muted">Send a kiss.</p><div className="kiss-list">{KISSES.map(item => <button key={item.id} onClick={() => choose(item.line)}><span aria-hidden="true">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.line.replace(/^\S+\s/, "")}</small></span></button>)}</div></>}
        {mode === "family" && <><p className="muted">Talk about your future.</p><div className="comfort-list">{["What baby names do you like?", "What would our future home be like?", "What traditions should we start?", "What does family mean to you?", "Where should we go together?"].map(line => <button key={line} onClick={() => choose("🌱 " + line)}><span aria-hidden="true">🌱</span><strong>{line}</strong></button>)}</div></>}
      </>}
      <ErrorNote text={error}/>
    </div>
  </Modal>;
}
