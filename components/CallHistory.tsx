"use client";

import { useEffect, useState } from "react";
import { Phone, Video } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { callLabel, type CallRow } from "@/lib/rtc";
import { errorText, type Conversation } from "@/lib/types";
import { ErrorNote, Spinner } from "./UI";

/** Call log for one chat, opened from Chat details. */
export default function CallHistory({ c, onCall }: { c: Conversation; onCall: (kind: "audio") => void }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await rpc<CallRow[]>("call_history", { p_conversation: c.id, p_limit: 40 });
        if (active) setRows(Array.isArray(data) ? data : []);
      } catch (cause) {
        if (active) { setError(errorText(cause)); setRows([]); }
      }
    })();
    return () => { active = false; };
  }, [c.id]);

  if (!rows) return <div className="center pad"><Spinner/></div>;
  return <section className="call-history" aria-label="Call history">
    <div className="call-history-actions">
      <button onClick={() => onCall("audio")}><Phone size={17}/>Call</button>
    </div>
    <ErrorNote text={error}/>
    {rows.length === 0 && <p className="muted call-history-empty">No calls yet. Your first one is a tap away.</p>}
    {rows.map(row => {
      const missed = row.status === "missed" || row.status === "declined";
      return <div key={row.id} className={"call-row " + (missed ? "missed" : "")}>
        <span className="call-row-icon"><Phone size={17}/></span>
        <span>
          <strong>Voice call</strong>
          <small>{new Date(row.started_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {callLabel(row)}</small>
        </span>
        <button className="call-row-again" aria-label="Call back" onClick={() => onCall("audio")}><Phone size={16}/></button>
      </div>;
    })}
  </section>;
}
