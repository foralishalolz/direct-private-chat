"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, BarChart3, Camera, Gamepad2, Heart, ImagePlus, LockKeyhole, Mic, Phone, Plus, Smile, Sticker, X } from "lucide-react";
import EmojiPicker from "./EmojiPicker";
import { AFFECTIONS, QUICK_AFFECTIONS, type AffectionId } from "@/lib/affection";
import { errorText, type Message } from "@/lib/types";
import { ErrorNote, IconButton, Spinner } from "./UI";

export type ComposerTool = "media" | "camera" | "sticker" | "capsules" | "polls" | "games" | "call";

const RECENT_KEY = "bitchat-emoji-recent";
const TOOLS = [
  { id: "media", label: "Photo", Icon: ImagePlus },
  { id: "camera", label: "Instant", Icon: Camera },
  { id: "sticker", label: "Sticker", Icon: Sticker },
  { id: "call", label: "Call", Icon: Phone },
  { id: "capsules", label: "Capsule", Icon: LockKeyhole },
  { id: "polls", label: "Poll", Icon: BarChart3 },
  { id: "games", label: "Play", Icon: Gamepad2 },
] as const;

function readRecent(): string[] {
  try { const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(raw) ? raw.filter(x => typeof x === "string").slice(0, 16) : []; } catch { return []; }
}

type Props = {
  busy: boolean;
  reply: Message | null;
  replyName: string;
  showCall?: boolean;
  onCancelReply: () => void;
  onSent: () => void;
  onSend: (text: string, replyId: string | null) => Promise<void>;
  onTyping: () => void;
  onTool: (tool: ComposerTool) => void;
  onVoice: () => void;
  onAffection: (id: AffectionId) => Promise<void>;
};

export default memo(function Composer({ busy, reply, replyName, showCall = false, onCancelReply, onSent, onSend, onTyping, onTool, onVoice, onAffection }: Props) {
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<"tools" | "emoji" | "affection" | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [sendingAffection, setSendingAffection] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), root = useRef<HTMLDivElement>(null), picker = useRef<HTMLDivElement>(null);
  const lock = useRef(false), alive = useRef(true), revision = useRef(0), affectionLock = useRef(false);

  useEffect(() => { alive.current = true; setRecent(readRecent()); return () => { alive.current = false; }; }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => { const node = input.current; if (node) { node.style.height = "auto"; node.style.height = Math.min(node.scrollHeight, 120) + "px"; } });
    return () => cancelAnimationFrame(frame);
  }, [text]);
  useLayoutEffect(() => { if (reply) input.current?.focus({ preventScroll: true }); }, [reply?.id]);

  /**
   * Bug fix: the emoji and attachment sheets used to stay open until their own
   * toggle was pressed again — a tap elsewhere, Escape, sending a message or
   * picking a tool all left them floating. Every dismissal path now funnels
   * through here.
   */
  const close = useCallback(() => setSheet(null), []);

  useEffect(() => {
    if (!sheet) return;
    const node = picker.current;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (node?.contains(target)) return;
      // Tapping the toggle itself is handled by the button, so ignore it here.
      if ((target as HTMLElement).closest?.("[data-sheet-toggle]")) return;
      close();
    };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); input.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("keydown", key); };
  }, [sheet, close]);

  // A reply, an incoming call sheet or a tool opening should not leave a stray sheet open.
  useEffect(() => { if (reply) close(); }, [reply?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSheet(next: "tools" | "emoji" | "affection") {
    setSheet(current => current === next ? null : next);
  }

  async function sendAffection(id: AffectionId) {
    if (affectionLock.current) return;
    affectionLock.current = true; setSendingAffection(true); setError("");
    try { await onAffection(id); if (alive.current) close(); }
    catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { affectionLock.current = false; if (alive.current) setSendingAffection(false); }
  }

  async function send() {
    if (lock.current || !text.trim()) return;
    lock.current = true;
    const draft = text, replyId = reply?.id ?? null, current = ++revision.current;
    setText(""); setError(""); close(); input.current?.focus();
    try { await onSend(draft, replyId); if (alive.current) onSent(); }
    catch (cause) { if (alive.current) { if (revision.current === current) setText(draft); setError(errorText(cause)); } }
    finally { lock.current = false; }
  }

  function insertEmoji(value: string) {
    const node = input.current, start = node?.selectionStart ?? text.length, end = node?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    if (next.length > 4000) return;
    const current = ++revision.current;
    setText(next); onTyping(); node?.focus({ preventScroll: true });
    const list = [value, ...recent.filter(item => item !== value)].slice(0, 16);
    setRecent(list);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
    requestAnimationFrame(() => { if (alive.current && revision.current === current) node?.setSelectionRange(start + value.length, start + value.length); });
  }

  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && window.matchMedia("(pointer:fine)").matches) {
      event.preventDefault(); void send();
    }
  }

  return <div className="composer-shell" ref={root}>
    <ErrorNote text={error}/>
    {reply && <div className="composer-reply"><span><small>Replying to {replyName}</small><p>{reply.content || "Photo"}</p></span><IconButton label="Cancel reply" onClick={onCancelReply}><X size={17}/></IconButton></div>}

    {sheet && <div className={"composer-sheet " + sheet} ref={picker} role="group" aria-label={sheet === "emoji" ? "Emoji" : sheet === "tools" ? "Attachments" : "Affection"}>
      <div className="composer-sheet-grip" aria-hidden="true"/>
      {sheet === "tools" && <div className="attachment-tray">
        <button className="affection-tool" aria-label="Affection" onClick={() => setSheet("affection")}><Heart/><small>Affection</small></button>
        {TOOLS.filter(tool => tool.id !== "call" || showCall).map(({ id, label, Icon }) => <button key={id} disabled={busy} onClick={() => { close(); onTool(id); }}><Icon/><small>{label}</small></button>)}
      </div>}

      {sheet === "affection" && <div className="affection-tray" aria-label="Send affection">{AFFECTIONS.filter(item => QUICK_AFFECTIONS.includes(item.id)).map(item => <button key={item.id} disabled={sendingAffection} aria-label={"Send " + item.label.toLowerCase()} onClick={() => void sendAffection(item.id)}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}</div>}

      {sheet === "emoji" && <EmojiPicker recent={recent} onPick={insertEmoji}/>}
    </div>}

    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <IconButton label="Attachments" data-sheet-toggle aria-expanded={sheet === "tools"} className={sheet === "tools" ? "selected" : ""} onClick={() => toggleSheet("tools")}>{busy ? <Spinner/> : <Plus size={23}/>}</IconButton>
      <textarea ref={input} rows={1} aria-label="Message" placeholder="Message…" value={text} maxLength={4000} autoComplete="on" autoCorrect="on" autoCapitalize="sentences" spellCheck onChange={event => { revision.current++; setText(event.target.value); onTyping(); }} onKeyDown={keys} onFocus={() => { if (sheet === "emoji") close(); }}/>
      <IconButton label="Emoji" data-sheet-toggle aria-expanded={sheet === "emoji"} className={"emoji-toggle " + (sheet === "emoji" ? "selected" : "")} onClick={() => toggleSheet("emoji")}><Smile size={20}/></IconButton>
      {text.trim()
        ? <button type="submit" className="send-button" aria-label="Send message" onPointerDown={event => { if (document.activeElement === input.current) event.preventDefault(); }}><ArrowUp size={22}/></button>
        : <IconButton label="Record voice note" className="voice-note-button" onClick={onVoice}><Mic size={18}/></IconButton>}
    </form>
  </div>;
});
