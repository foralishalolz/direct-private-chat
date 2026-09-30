"use client";
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, BarChart3, Camera, Gamepad2, ImagePlus, LockKeyhole, Mic, Plus, Smile, Sticker, X } from "lucide-react";
import { errorText, type Message } from "@/lib/types";
import { ErrorNote, IconButton, Spinner } from "./UI";

export type ComposerTool = "media" | "camera" | "sticker" | "capsules" | "polls" | "games";
const EMOJI = ["❤️", "🥰", "😘", "😂", "🫶", "🥹", "🔥", "🤍", "😈", "💋", "✨", "👀", "💕", "🥺", "😴", "🙈", "💀", "🤗", "💯", "🦋", "🌙", "☀️", "🍒", "🧸"];
const TOOLS = [{ id: "media", label: "Media", Icon: ImagePlus }, { id: "camera", label: "Instant", Icon: Camera }, { id: "sticker", label: "Sticker", Icon: Sticker }, { id: "capsules", label: "Capsule", Icon: LockKeyhole }, { id: "polls", label: "Poll", Icon: BarChart3 }, { id: "games", label: "Play", Icon: Gamepad2 }] as const;
type Props = { busy: boolean; reply: Message | null; replyName: string; onCancelReply: () => void; onSent: () => void; onSend: (text: string, replyId: string | null) => Promise<void>; onTyping: () => void; onTool: (tool: ComposerTool) => void; onVoice: () => void };

export default memo(function Composer({ busy, reply, replyName, onCancelReply, onSent, onSend, onTyping, onTool, onVoice }: Props) {
  const [text, setText] = useState(""), [tools, setTools] = useState(false), [emoji, setEmoji] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null), lock = useRef(false), alive = useRef(true), revision = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { const frame = requestAnimationFrame(() => { const node = input.current; if (node) { node.style.height = "auto"; node.style.height = Math.min(node.scrollHeight, 120) + "px"; } }); return () => cancelAnimationFrame(frame); }, [text]);

  async function send() {
    if (lock.current || !text.trim()) return;
    lock.current = true;
    const draft = text, replyId = reply?.id ?? null, current = ++revision.current;
    setText(""); setError(""); setEmoji(false); input.current?.focus();
    try { await onSend(draft, replyId); if (alive.current) onSent(); }
    catch (cause) { if (alive.current) { if (revision.current === current) setText(draft); setError(errorText(cause)); } }
    finally { lock.current = false; }
  }
  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && window.matchMedia("(pointer:fine)").matches) { event.preventDefault(); void send(); }
  }
  return <>
    <ErrorNote text={error}/>
    {reply && <div className="composer-reply"><span><small>Replying to {replyName}</small><p>{reply.content || "Photo"}</p></span><IconButton label="Cancel reply" onClick={onCancelReply}><X size={17}/></IconButton></div>}
    {tools && <div className="attachment-tray">{TOOLS.map(({ id, label, Icon }) => <button key={id} disabled={busy} onClick={() => { setTools(false); onTool(id); }}><Icon/><small>{label}</small></button>)}</div>}
    {emoji && <div className="emoji-picker">{EMOJI.map(value => <button key={value} aria-label={value} onClick={() => { revision.current++; setText(previous => (previous + value).slice(0, 4000)); input.current?.focus(); }}>{value}</button>)}</div>}
    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <IconButton label="Attachments" aria-expanded={tools} className={tools ? "selected" : ""} onClick={() => { setTools(!tools); setEmoji(false); }}>{busy ? <Spinner/> : <Plus size={23}/>}</IconButton>
      <textarea ref={input} rows={1} aria-label="Message" placeholder="Message…" value={text} maxLength={4000} autoComplete="on" autoCorrect="on" autoCapitalize="sentences" spellCheck onChange={event => { revision.current++; setText(event.target.value); onTyping(); }} onKeyDown={keys}/>
      <IconButton label="Emoji" aria-expanded={emoji} className="emoji-toggle" onClick={() => { setEmoji(!emoji); setTools(false); }}><Smile size={20}/></IconButton>
      {text.trim() ? <button type="submit" className="send-button" aria-label="Send message" onPointerDown={event => { if (document.activeElement === input.current) event.preventDefault(); }}><ArrowUp size={22}/></button> : <IconButton label="Record voice note" className="voice-note-button" onClick={onVoice}><Mic size={18}/></IconButton>}
    </form>
  </>;
});
