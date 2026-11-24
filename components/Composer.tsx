"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Camera, Heart, ImagePlus, Link2, Mic, Music2, Plus, Smile, Sparkles, Sticker, X } from "lucide-react";
import EmojiPicker from "./EmojiPicker";
import { normalizeReelUrl } from "@/lib/reels";
import { AFFECTIONS, QUICK_AFFECTIONS, type AffectionId } from "@/lib/affection";
import { haptic } from "@/lib/haptics";
import { TEXT_EFFECTS, textEffectLabel, type TextEffect } from "@/lib/textEffects";
import { errorText, type Message } from "@/lib/types";
import { ErrorNote, IconButton, Modal, Spinner } from "./UI";

/** One canonical tool per job. Chat activities live in their own dock/panels. */
export type ComposerTool = "media" | "audio" | "camera" | "sticker";

const RECENT_KEY = "bitchat-emoji-recent";
const TOOLS = [
  { id: "link", label: "Link", Icon: Link2 },
  { id: "media", label: "Photo & video", Icon: ImagePlus },
  { id: "camera", label: "Instant", Icon: Camera },
  { id: "audio", label: "Audio", Icon: Music2 },
  { id: "sticker", label: "Sticker", Icon: Sticker },
  { id: "affection", label: "Quick affection", Icon: Heart },
] as const;

type Sheet = "tools" | "emoji" | "affection" | "effects" | null;

function readRecent(): string[] {
  try { const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(raw) ? raw.filter(x => typeof x === "string").slice(0, 16) : []; } catch { return []; }
}

type Props = {
  busy: boolean;
  reply: Message | null;
  replyName: string;
  onCancelReply: () => void;
  onSent: () => void;
  onSend: (text: string, replyId: string | null, effect: TextEffect) => Promise<void>;
  onTyping: () => void;
  onTool: (tool: ComposerTool) => void;
  onVoice: () => void;
  onAffection: (id: AffectionId) => Promise<void>;
};

export default memo(function Composer({ busy, reply, replyName, onCancelReply, onSent, onSend, onTyping, onTool, onVoice, onAffection }: Props) {
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [effect, setEffect] = useState<TextEffect>("normal");
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false), [linkValue, setLinkValue] = useState(""), [linkError, setLinkError] = useState("");
  const linkSelection = useRef({ start: 0, end: 0 });
  const [sendingAffection, setSendingAffection] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), root = useRef<HTMLDivElement>(null), picker = useRef<HTMLDivElement>(null);
  const lock = useRef(false), alive = useRef(true), revision = useRef(0), affectionLock = useRef(false), insertingEmoji = useRef(false);

  useEffect(() => { alive.current = true; setRecent(readRecent()); return () => { alive.current = false; }; }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => { const node = input.current; if (node) { node.style.height = "auto"; node.style.height = Math.min(node.scrollHeight, 120) + "px"; } });
    return () => cancelAnimationFrame(frame);
  }, [text]);
  useLayoutEffect(() => { if (reply) input.current?.focus({ preventScroll: true }); }, [reply?.id]);

  /** Every dismissal path funnels through here, so sheets never float. */
  const close = useCallback(() => setSheet(null), []);

  useEffect(() => {
    if (!sheet) return;
    const node = picker.current;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (node?.contains(target)) return;
      if ((target as HTMLElement).closest?.("[data-sheet-toggle]")) return;
      close();
    };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); input.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("keydown", key); };
  }, [sheet, close]);

  useEffect(() => { if (reply) close(); }, [reply?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSheet(next: Exclude<Sheet, null>) {
    setSheet(current => current === next ? null : next);
  }

  async function sendAffection(id: AffectionId) {
    if (affectionLock.current) return;
    affectionLock.current = true; setSendingAffection(true); setError("");
    try { await onAffection(id); if (alive.current) close(); }
    catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { affectionLock.current = false; if (alive.current) setSendingAffection(false); }
  }

  function chooseEffect(next: TextEffect) {
    haptic("light");
    setEffect(next);
    close();
    input.current?.focus({ preventScroll: true });
  }

  async function send() {
    if (lock.current || !text.trim()) return;
    lock.current = true;
    const draft = text, replyId = reply?.id ?? null, chosen = effect, current = ++revision.current;
    setText(""); setError(""); setEffect("normal"); close(); input.current?.focus(); haptic("light");
    try { await onSend(draft, replyId, chosen); if (alive.current) onSent(); }
    catch (cause) { if (alive.current) { if (revision.current === current) { setText(draft); setEffect(chosen); } setError(errorText(cause)); } }
    finally { lock.current = false; }
  }

  function insertEmoji(value: string) {
    const node = input.current, start = node?.selectionStart ?? text.length, end = node?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    if (next.length > 4000) return;
    const current = ++revision.current;
    setText(next); onTyping(); insertingEmoji.current = true; node?.focus({ preventScroll: true }); insertingEmoji.current = false;
    const list = [value, ...recent.filter(item => item !== value)].slice(0, 16);
    setRecent(list);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
    requestAnimationFrame(() => { if (alive.current && revision.current === current) node?.setSelectionRange(start + value.length, start + value.length); });
  }

  function insertLink() {
    try {
      const link = normalizeReelUrl(linkValue), { start, end } = linkSelection.current;
      const before = text.slice(0, start), after = text.slice(end);
      const prefix = before && !/\s$/.test(before) ? " " : "", suffix = after && !/^\s/.test(after) ? " " : "";
      const next = before + prefix + link + suffix + after;
      if (next.length > 4000) throw new Error("The message is too long.");
      const cursor = before.length + prefix.length + link.length + suffix.length;
      revision.current++; setText(next); onTyping(); setLinkOpen(false); setLinkValue(""); setLinkError("");
      requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(cursor, cursor); });
    } catch (cause) { setLinkError(errorText(cause)); }
  }

  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && window.matchMedia("(pointer:fine)").matches) {
      event.preventDefault(); void send();
    }
  }

  const sheetLabel = sheet === "emoji" ? "Emoji" : sheet === "tools" ? "Attachments" : sheet === "effects" ? "Text effects" : "Affection";

  return <div className="composer-shell" ref={root}>
    <ErrorNote text={error} />
    {reply && <div className="composer-reply"><span><small>Replying to {replyName}</small><p>{reply.content || "Photo"}</p></span><IconButton label="Cancel reply" onClick={onCancelReply}><X size={17} /></IconButton></div>}

    {effect !== "normal" && <div className="composer-effect-chip" role="status">
      <Sparkles size={13} aria-hidden="true" /><span>{textEffectLabel(effect)} effect</span>
      <button type="button" aria-label="Remove text effect" onClick={() => chooseEffect("normal")}><X size={13} /></button>
    </div>}

    {sheet && <div className={"composer-sheet " + sheet} ref={picker} role="group" aria-label={sheetLabel}>
      <div className="composer-sheet-grip" aria-hidden="true" />
      {sheet === "tools" && <div className="attachment-tray">
        {TOOLS.map(({ id, label, Icon }) => <button type="button" key={id} disabled={busy} onClick={() => { if (id === "link") { close(); linkSelection.current = { start: input.current?.selectionStart ?? text.length, end: input.current?.selectionEnd ?? text.length }; setLinkError(""); setLinkOpen(true); } else if (id === "affection") { setSheet("affection"); } else { close(); onTool(id); } }}><Icon /><small>{label}</small></button>)}
      </div>}

      {sheet === "effects" && <div className="effects-tray" aria-label="Text effects">
        {TEXT_EFFECTS.map(item => <button type="button" key={item.id} aria-label={item.aria} aria-pressed={effect === item.id} title={item.hint} onClick={() => chooseEffect(item.id)}>
          <span aria-hidden="true" className={"effect-glyph " + item.id}>{item.glyph}</span><small>{item.label}</small>
        </button>)}
      </div>}

      {sheet === "affection" && <div className="affection-tray" aria-label="Send affection">{AFFECTIONS.filter(item => QUICK_AFFECTIONS.includes(item.id)).map(item => <button type="button" key={item.id} disabled={sendingAffection} aria-label={"Send " + item.label.toLowerCase()} onClick={() => void sendAffection(item.id)}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}</div>}

      {sheet === "emoji" && <EmojiPicker recent={recent} onPick={insertEmoji} />}
    </div>}

    {linkOpen && <Modal title="Share a link" onClose={() => { setLinkOpen(false); setLinkError(""); }}><form className="panel-pad link-compose" onSubmit={event => { event.preventDefault(); insertLink(); }}><label htmlFor="share-url">Website, reel, video or music link</label><input id="share-url" type="url" inputMode="url" autoComplete="url" placeholder="https://…" maxLength={2048} value={linkValue} onChange={event => { setLinkValue(event.target.value); setLinkError(""); }} required /><small>Add the link to your message, then send it.</small><ErrorNote text={linkError} /><button className="primary full" type="submit">Add to message</button></form></Modal>}

    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <IconButton label="Attachments" data-sheet-toggle aria-expanded={sheet === "tools"} className={sheet === "tools" ? "selected" : ""} onClick={() => toggleSheet("tools")}>{busy ? <Spinner /> : <Plus size={23} />}</IconButton>
      <IconButton label="Text effects" data-sheet-toggle aria-expanded={sheet === "effects"} className={"effects-toggle " + (sheet === "effects" ? "selected" : "")} onClick={() => toggleSheet("effects")}><Sparkles size={19} /></IconButton>
      <textarea ref={input} rows={1} aria-label="Message" placeholder="Message…" value={text} maxLength={4000} autoComplete="on" autoCorrect="on" autoCapitalize="sentences" spellCheck className={effect === "big" ? "effect-preview-big" : effect === "small" ? "effect-preview-small" : ""} data-text-effect={effect} onChange={event => { revision.current++; setText(event.target.value); onTyping(); }} onKeyDown={keys} onFocus={() => { if ((sheet === "emoji" || sheet === "effects") && !insertingEmoji.current) close(); }} />
      <IconButton label="Emoji" data-sheet-toggle aria-expanded={sheet === "emoji"} className={"emoji-toggle " + (sheet === "emoji" ? "selected" : "")} onClick={() => toggleSheet("emoji")}><Smile size={20} /></IconButton>
      {text.trim()
        ? <button type="submit" className="send-button" aria-label="Send message" onPointerDown={event => { if (document.activeElement === input.current) event.preventDefault(); }}><ArrowUp size={22} /></button>
        : <IconButton label="Record voice note" className="voice-note-button" onClick={onVoice}><Mic size={18} /></IconButton>}
    </form>
  </div>;
});
