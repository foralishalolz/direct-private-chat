"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Pin as PinIcon, Trash2 } from "lucide-react";
import { listSaved, removeSaved, type SavedMessage } from "@/lib/saved";
import { label, time } from "@/lib/types";
import { Avatar, ErrorNote, IconButton, Modal, Spinner } from "./UI";

/**
 * Telegram-style saved messages: anything you forward here is kept locally for
 * this account only. Nothing is uploaded, so it works offline and never leaves
 * the device.
 */
export default function SavedModal({ userId, onClose, onOpenChat }: { userId: string; onClose: () => void; onOpenChat?: (conversationId: string) => void }) {
  const [rows, setRows] = useState<SavedMessage[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    void listSaved(userId).then(saved => { if (active) setRows(saved); }).catch(cause => {
      if (active) { setError(cause instanceof Error ? cause.message : "Saved messages are unavailable."); setRows([]); }
    });
    return () => { active = false; };
  }, [userId]);

  async function drop(id: string) {
    try {
      await removeSaved(userId, id);
      setRows(current => current?.filter(row => row.id !== id) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove that."); }
  }

  const needle = query.trim().toLowerCase();
  const shown = (rows ?? []).filter(row => !needle || row.content.toLowerCase().includes(needle));

  return <Modal title="Saved" wide onClose={onClose}>
    <div className="panel-pad">
      {rows && rows.length > 0 && <label className="input-icon"><input aria-label="Search saved messages" placeholder="Search saved" value={query} maxLength={80} onChange={event => setQuery(event.target.value)}/></label>}
      <ErrorNote text={error}/>
      {!rows && <div className="center pad"><Spinner/></div>}
      {rows && !shown.length && <p className="muted saved-empty">Nothing saved yet. Hold any message and choose <b>Save</b> — pins, links and photos you never want to lose end up here.</p>}
      <div className="saved-list">{shown.map(row => <article key={row.id} className="saved-item">
        <header>
          <Avatar profile={{ id: row.author_id, display_name: row.author_name, username: row.author_name }} size={26}/>
          <span><strong>{row.author_name}</strong><small>{row.conversation_title || "Chat"} · {time(row.created_at)}</small></span>
          <IconButton label="Remove saved message" onClick={() => void drop(row.id)}><Trash2 size={15}/></IconButton>
        </header>
        {row.content && <p>{row.content}</p>}
        <footer>
          {row.media_kind && <small className="saved-media">{row.media_kind === "image" ? "Photo" : row.media_kind === "video" ? "Video" : "Voice note"} · kept in the chat</small>}
          {row.conversation_id && onOpenChat && <button className="saved-open" onClick={() => { onOpenChat(row.conversation_id); onClose(); }}><MessageSquare size={14}/>Open chat</button>}
        </footer>
      </article>)}</div>
      <p className="saved-note"><PinIcon size={12}/>Saved items live on this device only — clear site data and they go too.</p>
    </div>
  </Modal>;
}
