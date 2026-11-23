"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Send, Sparkles } from "lucide-react";
import { MISS_LINES } from "@/lib/affection";
import { errorText, label, type Conversation, type Profile } from "@/lib/types";
import { Avatar, ErrorNote, Spinner } from "./UI";

/**
 * "I miss you" spam. Picks random lines and sends them one at a time so the
 * partner's phone lights up a few times instead of once. Capped so it stays
 * affectionate rather than abusive.
 */
export default function MissYouTray({ c, p, onSend, onClose }: {
  c: Conversation;
  p: Profile;
  onSend: (text: string, kind: "miss") => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => [MISS_LINES[0]]);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState("");
  const alive = useRef(true), lock = useRef(false), used = useRef<string[]>([]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const shuffle = useCallback((howMany: number) => {
    const pool = MISS_LINES.filter(line => !used.current.includes(line));
    const source = pool.length >= howMany ? pool : [...MISS_LINES];
    const next: string[] = [];
    while (next.length < howMany) {
      const line = source[crypto.getRandomValues(new Uint32Array(1))[0] % source.length];
      if (!next.includes(line)) next.push(line);
    }
    used.current = [...used.current, ...next].slice(-8);
    return next;
  }, []);

  async function burst() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSent(0);
    const lines = shuffle(count);
    setPicked(lines);
    try {
      for (const line of lines) {
        await onSend(line, "miss");
        if (!alive.current) return;
        setSent(value => value + 1);
        // A short beat between messages keeps the inbox readable.
        await new Promise(resolve => setTimeout(resolve, 380));
      }
      if (alive.current) setTimeout(() => { if (alive.current) onClose(); }, 650);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const partnerName = c.partner ? label(c.partner) : "them";

  return (
    <div className="miss-tray" aria-label="I miss you">
      <div className="miss-head">
        <Avatar profile={c.partner} size={42} />
        <div><strong>Miss {partnerName}?</strong><small>Send a few soft pings</small></div>
      </div>
      <div className="miss-lines" aria-live="polite">
        {picked.map(line => <span key={line}>{line}</span>)}
      </div>
      <div className="miss-count" role="group" aria-label="How many">
        {[2, 4, 6].map(value => (
          <button key={value} type="button" aria-pressed={count === value} className={count === value ? "active" : ""} disabled={busy} onClick={() => setCount(value)}>{value}</button>
        ))}
        <button type="button" className="miss-shuffle" disabled={busy} aria-label="Shuffle lines" onClick={() => setPicked(shuffle(count))}><Sparkles size={16} />Shuffle</button>
      </div>
      <div className="miss-actions">
        <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="primary miss-send" disabled={busy} onClick={() => void burst()}>
          {busy ? <><Spinner />{sent}/{count}</> : <><Send size={17} />Send {count} <Heart size={15} /></>}
        </button>
      </div>
      <ErrorNote text={error} />
    </div>
  );
}
