"use client";
import { useRef, useState } from "react";
import { rpc } from "@/lib/supabase";
import { clearConversation } from "@/lib/offline";
import { errorText } from "@/lib/types";
import { ErrorNote, Modal, Spinner } from "./UI";

export default function ChatActionModal({ action, conversationId, userId, onClose, onDone }: { action: "clear" | "leave"; conversationId: string; userId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  async function confirm() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const before = action === "leave" ? (await rpc("leave_group", { p_conversation: conversationId }), new Date().toISOString()) : await rpc<string>("clear_chat", { p_conversation: conversationId });
      await clearConversation(userId, conversationId, before);
      await onDone(); onClose();
    } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal title={action === "leave" ? "Leave group?" : "Delete chat?"} onClose={() => { if (!busy) onClose(); }}><div className="panel-pad"><p className="confirmation-copy">{action === "leave" ? "You’ll need an invitation to join again." : "This clears messages and pending sends for your account. Other members keep their copy."}</p><div className="confirmation-actions"><button className="quiet-button" disabled={busy} onClick={onClose}>Cancel</button><button className="danger-button" disabled={busy} onClick={() => void confirm()}>{busy ? <Spinner/> : action === "leave" ? "Leave group" : "Delete for me"}</button></div><ErrorNote text={error}/></div></Modal>;
}
