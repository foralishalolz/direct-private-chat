"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Sticker, Trash2, X } from "lucide-react";
import { deleteSticker, listStickers, type SavedSticker } from "@/lib/stickers";
import { errorText } from "@/lib/types";
import { StickerMaker } from "./MediaTools";
import { ErrorNote, IconButton, Modal, Spinner } from "./UI";

function Tile({ row, editing, busy, onClick }: { row: SavedSticker; editing: boolean; busy: boolean; onClick: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(row.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [row.blob]);
  return <button className="sticker-tile" disabled={busy} aria-label={editing ? "Remove saved sticker" : "Send saved sticker"} onClick={onClick}>{url && <img src={url} alt="" draggable={false} decoding="async"/>}{editing && <span className="sticker-remove"><X size={13}/></span>}</button>;
}

export default function StickerCollection({ userId, onSend, onClose }: { userId: string; onSend: (blob: Blob) => Promise<void>; onClose: () => void }) {
  const [rows, setRows] = useState<SavedSticker[]>([]), [creating, setCreating] = useState(false), [editing, setEditing] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { let active = true; void listStickers(userId).then(data => { if (active) setRows(data); }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [userId, creating]);
  async function choose(row: SavedSticker) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { if (editing) { await deleteSticker(userId, row.id); if (alive.current) setRows(previous => previous.filter(item => item.id !== row.id)); } else { await onSend(row.blob); if (alive.current) onClose(); } }
    catch (e) { if (alive.current) setError(errorText(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (creating) return <StickerMaker userId={userId} onSend={onSend} onClose={() => setCreating(false)}/>;
  return <Modal title="Stickers" onClose={onClose}><div className="panel-pad"><div className="row sticker-toolbar"><button className="quiet-button" onClick={() => setCreating(true)}><Plus size={18}/>Create</button><span className="push muted">{rows.length}/60</span><IconButton label={editing ? "Done managing stickers" : "Manage stickers"} disabled={!rows.length || busy} onClick={() => setEditing(!editing)}>{editing ? <Check size={19}/> : <Trash2 size={18}/>}</IconButton></div>{loading ? <div className="center pad"><Spinner/></div> : rows.length ? <div className="sticker-grid">{rows.map(row => <Tile key={row.id} row={row} editing={editing} busy={busy} onClick={() => void choose(row)}/>)}</div> : <button className="empty-stickers" onClick={() => setCreating(true)}><Sticker size={32}/><span>Create sticker</span></button>}<ErrorNote text={error}/></div></Modal>;
}
