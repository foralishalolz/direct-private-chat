"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, ChevronDown, Coins, Copy, Dices, Download, Heart, Link2, LogOut, Pencil, ShieldCheck, Trash2, X } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { useLive } from "@/hooks/useLive";
import { clearConversation } from "@/lib/offline";
import { downloadMedia } from "@/lib/export";
import { day, errorText, label, time, type Conversation, type Message, type Profile } from "@/lib/types";
import { Avatar, ErrorNote, IconButton, Modal, Spinner } from "./UI";
import { PrivateMedia } from "./MessageBubble";

type ChatProps = { c: Conversation; p: Profile };

export function ChatDetails({ c, p, onRefresh, onExit }: ChatProps & { onRefresh: () => Promise<void>; onExit: () => void }) {
  const [name, setName] = useState(c.title);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [confirm, setConfirm] = useState<"clear" | "leave" | null>(null);
  const lock = useRef(false);
  const admin = c.created_by === p.id || p.is_pro;
  const mine = c.member_a === p.id ? c.couple_a : c.couple_b;

  useEffect(() => {
    let active = true;
    if (c.partner && c.kind === "direct") void rpc<{ other_id: string }[]>("my_blocks").then(rows => {
      if (active) setBlocked(rows.some(row => row.other_id === c.partner?.id));
    }).catch(e => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [c.kind, c.partner?.id]);

  async function act(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function remove() {
    if (confirm === "leave") {
      await rpc("leave_group", { p_conversation: c.id });
      await clearConversation(p.id, c.id, new Date().toISOString());
    } else {
      const before = await rpc<string>("clear_chat", { p_conversation: c.id });
      await clearConversation(p.id, c.id, before);
    }
    onExit();
    await onRefresh();
  }

  return <div className="chat-details">
    <div className="details-identity"><Avatar profile={c.partner} group={c.kind === "group"} size={76}/><h3>{c.kind === "group" ? c.title : label(c.partner)}</h3><small>{c.kind === "group" ? `${c.members?.length ?? 0} members` : `@${c.partner?.username ?? ""}`}</small></div>
    {c.kind === "group" ? <>
      {admin && <form className="row spaced" onSubmit={e => { e.preventDefault(); void act(async () => { await rpc("rename_group", { p_conversation: c.id, p_title: name.trim() }); await onRefresh(); }); }}>
        <input className="grow" aria-label="Group name" maxLength={60} value={name} onChange={e => setName(e.target.value)}/>
        <button className="primary" aria-label="Save group name" disabled={busy || !name.trim() || name.trim() === c.title}><Check size={20}/></button>
      </form>}
      <div className="member-list">{c.members?.map(member => <div className="member-row" key={member.id}>
        <Avatar profile={member} size={38}/><span><strong>{member.id === p.id ? "You" : label(member)}</strong><small>@{member.username}</small></span>{c.created_by === member.id && <span className="quiet-badge">Admin</span>}
      </div>)}</div>
      {admin && <div className="settings-section">
        <button className="menu-item" disabled={busy} onClick={() => void act(async () => { setCode(await rpc<string>("group_invite", { p_conversation: c.id })); setCopied(false); })}><Link2 size={20}/>{code ? "Replace invite code" : "Create invite code"}</button>
        {code && <div className="invite-code"><input aria-label="Group invite code" value={code} readOnly onFocus={e => e.target.select()}/><IconButton label="Copy invite code" onClick={() => void act(async () => { await navigator.clipboard.writeText(code); setCopied(true); })}>{copied ? <Check size={18}/> : <Copy size={18}/>}</IconButton><small>Expires in 7 days</small></div>}
        <button className="menu-item" disabled={busy} onClick={() => void act(async () => { await rpc("group_invite", { p_conversation: c.id, p_revoke: true }); setCode(""); })}><X size={20}/>Revoke invite code</button>
      </div>}
    </> : <div className="settings-section">
      <button className="menu-item" disabled={busy} onClick={() => void act(async () => { await rpc("set_couple_mode", { p_conversation: c.id, p_enabled: !mine }); await onRefresh(); })}>
        <Heart size={20}/><span>Couple mode</span><span className={`switch ${mine ? "on" : ""}`} role="switch" aria-label="Couple mode" aria-checked={mine}/>
      </button>
      {mine && !(c.couple_a && c.couple_b) && <small className="muted">Waiting for {label(c.partner)}</small>}
      <button className="menu-item" disabled={busy} onClick={() => void act(async () => { await rpc("set_block", { p_other: c.partner?.id, p_blocked: !blocked }); setBlocked(!blocked); })}><ShieldCheck size={20}/>{blocked ? "Unblock" : "Block"}</button>
    </div>}
    <div className="settings-section"><button className="menu-item danger" disabled={busy} onClick={() => setConfirm("clear")}><Trash2 size={20}/>Delete chat</button>
      {c.kind === "group" && <button className="menu-item danger" disabled={busy} onClick={() => setConfirm("leave")}><LogOut size={20}/>Leave group</button>}
    </div><ErrorNote text={error}/>
    {confirm && <Modal title={confirm === "leave" ? "Leave group?" : "Delete chat?"} onClose={() => { if (!busy) setConfirm(null); }}>
      <div className="panel-pad"><p className="confirmation-copy">{confirm === "leave" ? "You’ll need an invitation to join again." : "This clears the messages and pending sends for your account. Other members keep their copy."}</p>
        <div className="confirmation-actions"><button className="quiet-button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button className="danger-button" disabled={busy} onClick={() => void act(remove)}>{busy ? <Spinner/> : confirm === "leave" ? "Leave group" : "Delete for me"}</button></div><ErrorNote text={error}/>
      </div>
    </Modal>}
  </div>;
}

type Receipt = Pick<Profile, "id" | "username" | "display_name" | "avatar_url"> & { user_id: string; read_at: string | null };
export function MessageReceipts({ message, onClose }: { message: Message; onClose: () => void }) {
  const live = useLive<Receipt[]>("receipts:" + message.id, ["conversation_members", "conversations"], () => rpc("message_receipts", { p_message: message.id }), []);
  return <Modal title="Message info" onClose={onClose}><div className="panel-pad">
    <div className="receipt-preview">{message.content || (message.kind === "instant" ? "Photo" : "Media")}<small>{day(message.created_at)} · {time(message.created_at)}</small></div>
    <div className="member-list">{live.data.map(row => <div className="member-row" key={row.user_id}><Avatar profile={{ ...row, id: row.user_id }} size={40}/><span><strong>{label(row)}</strong><small>{row.read_at ? `Seen · ${time(row.read_at)}` : "Sent"}</small></span>{row.read_at ? <CheckCheck className="read" size={19}/> : <Check size={18}/>}</div>)}</div>
    {live.loading && <Spinner/>}<ErrorNote text={live.error}/>
  </div></Modal>;
}

type HistoryItem = { id: string; message_id: string; username: string; kind: "edited" | "deleted"; before_content: string; after_content: string | null; created_at: string; event_at: string; media_url: string | null; media_kind: Message["media_kind"] };
export function MessageHistory({ c }: { c: Conversation }) {
  const [filter, setFilter] = useState("all"), [older, setOlder] = useState<HistoryItem[]>([]), [more, setMore] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  const live = useLive<HistoryItem[]>("history:" + c.id + ":" + filter, ["messages"], () => rpc("message_history", { p_conversation: c.id, p_kind: filter }), []);
  useEffect(() => { generation.current++; setOlder([]); setMore(true); setError(""); setBusy(false); }, [filter, c.id, live.data]);
  const rows = [...live.data, ...older];
  async function loadOlder() {
    const last = rows.at(-1), n = generation.current;
    if (!last || busy) return;
    setBusy(true);
    try {
      const page = await rpc<HistoryItem[]>("message_history", { p_conversation: c.id, p_kind: filter, p_before: last.event_at, p_before_id: last.id });
      if (n === generation.current) { setOlder(previous => [...previous, ...page]); setMore(page.length === 30); }
    } catch (e) { if (n === generation.current) setError(errorText(e)); }
    finally { if (n === generation.current) setBusy(false); }
  }
  return <><div className="segmented" aria-label="History filter">{["all", "edited", "deleted"].map(kind => <button key={kind} aria-pressed={kind === filter} onClick={() => setFilter(kind)}>{kind[0].toUpperCase() + kind.slice(1)}</button>)}</div>
    <div className="history-list">{rows.map(item => <article className="history-card" key={item.id + item.kind}>
      <header>{item.kind === "edited" ? <Pencil size={15}/> : <Trash2 size={15}/>}<strong>@{item.username}</strong><time>{day(item.event_at)} · {time(item.event_at)}</time></header>
      <p className={item.kind === "edited" ? "previous-text" : ""}>{item.before_content || (item.media_url ? "" : "Media")}</p>
      {item.kind === "edited" && <p>{item.after_content}</p>}
      {item.media_url && <><PrivateMedia path={item.media_url} kind={item.media_kind}/><button className="menu-item" onClick={() => void downloadMedia(item.media_url!).catch(e => setError(errorText(e)))}><Download size={17}/>Save</button></>}
    </article>)}</div>
    {live.loading || busy ? <Spinner/> : !rows.length && <p className="empty-label">No history</p>}
    {more && live.data.length === 30 && <IconButton label="Older history" disabled={busy} onClick={() => void loadOlder()}><ChevronDown size={20}/></IconButton>}<ErrorNote text={error || live.error}/>
  </>;
}

export function QuickPlay({ c }: { c: Conversation }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState("");
  const lock = useRef(false);
  async function play(kind: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setResult("");
    try { await rpc("quick_play", { p_id: crypto.randomUUID(), p_conversation: c.id, p_kind: kind }); setResult("Sent to chat"); }
    catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <div className="quick-play"><div className="play-tiles"><button disabled={busy} onClick={() => void play("dice")}><Dices size={27}/><span>Roll a dice</span></button><button disabled={busy} onClick={() => void play("coin")}><Coins size={27}/><span>Flip a coin</span></button></div><span className="action-status" role="status">{busy ? <Spinner/> : result}</span><ErrorNote text={error}/></div>;
}
