"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Redo2, Trash2, Undo2 } from "lucide-react";
import { db, rpc } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { mergeBoard, type Point, type Stroke, type BoardEdit } from "@/lib/board";
export type { Stroke } from "@/lib/board";
import { errorText, label, type Conversation, type Profile } from "@/lib/types";
import { ErrorNote, IconButton, Modal, Spinner } from "./UI";

const COLORS = ["#ff6ea8", "#c9b6ff", "#7fe3c8", "#ffd479", "#8fc8ff", "#f2f0f6"];
const WIDTHS = [3, 6, 11];
const MAX_POINTS = 900;

/**
 * A shared canvas. Both people draw on the same list of strokes and every
 * change is written back to `drawing_board`, so it appears live on the other
 * screen. Either side can undo, erase one stroke by tapping it, or clear it —
 * changes are merged by stroke so concurrent edits to different strokes survive.
 */
export default function DrawBoard({ c, p, onClose }: { c: Conversation; p: Profile; onClose: () => void }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [erase, setErase] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke[]>([]);
  const drawing = useRef<{ id: string; points: Point[] } | null>(null);
  const base = useRef<Stroke[]>([]);
  const pending = useRef(new Map<string, BoardEdit>());
  const savingRef = useRef(false);
  const alive = useRef(true);
  const remote = useRef<string>("");
  const version = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const render = useCallback(() => {
    const next = mergeBoard(base.current, pending.current);
    live.current = next;
    if (alive.current) setStrokes(next);
  }, []);
  const applyRemote = useCallback((row: { strokes: Stroke[]; updated_at?: string }) => {
    if (remote.current && (!row.updated_at || Date.parse(row.updated_at) < Date.parse(remote.current))) { render(); return; }
    remote.current = row.updated_at ?? remote.current;
    base.current = row.strokes;
    render();
  }, [render]);
  const edit = (id: string, stroke: Stroke | null) => {
    version.current++;
    pending.current.set(id, { stroke, version: version.current });
    render();
  };


  const paint = useCallback(() => {
    const node = canvas.current;
    if (!node) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const rect = node.getBoundingClientRect();
    const w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio);
    if (node.width !== w || node.height !== h) { node.width = w; node.height = h; }
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of live.current) {
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      stroke.points.forEach(([x, y], index) => {
        const px = x * rect.width, py = y * rect.height;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      // A single tap should leave a dot, not nothing.
      if (stroke.points.length === 1) {
        const [x, y] = stroke.points[0];
        ctx.fillStyle = stroke.color;
        ctx.arc(x * rect.width, y * rect.height, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.stroke();
    }
  }, []);

  useEffect(() => { paint(); }, [strokes, paint]);
  useEffect(() => {
    const observer = new ResizeObserver(() => paint());
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [paint]);

  const load = useCallback(async () => {
    try {
      const result = await db().from("drawing_board").select("strokes,updated_at").eq("conversation_id", c.id).maybeSingle();
      if (result.error) throw result.error;
      if (!alive.current) return;
      const rows = (result.data?.strokes as Stroke[] | undefined) ?? [];
      applyRemote({ strokes: rows, updated_at: result.data?.updated_at });
      if (!pending.current.size) setError("");
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [c.id, applyRemote]);

  useEffect(() => {
    alive.current = true;
    void load();
    const client = db();
    const channel = client.channel("board:" + c.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawing_board", filter: "conversation_id=eq." + c.id }, payload => {
        const row = payload.new as { strokes?: Stroke[]; updated_at?: string; updated_by?: string } | null;
        if (!row?.strokes) return;
        applyRemote({ strokes: row.strokes, updated_at: row.updated_at });
      })
      .subscribe(status => { if (status === "SUBSCRIBED") void load(); });
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    return () => { alive.current = false; clearInterval(poll); void client.removeChannel(channel); };
  }, [c.id, load, applyRemote]);

  // Send only changed strokes; the server serializes patches per board.
  const flush = useCallback(async () => {
    if (savingRef.current || pending.current.size === 0) return;
    savingRef.current = true;
    if (alive.current) setSaving(true);
    const snapshot = new Map(pending.current);
    let succeeded = false;
    try {
      const upserts = [...snapshot.values()].flatMap(({ stroke }) => stroke ? [{ ...stroke, points: stroke.points.slice(0, MAX_POINTS) }] : []);
      const remove = [...snapshot.entries()].filter(([, value]) => !value.stroke).map(([id]) => id);
      const result = await rpc<{ strokes: Stroke[]; updated_at: string }>("edit_board", { p_conversation: c.id, p_upserts: upserts, p_remove: remove });
      for (const [id, sent] of snapshot) if (pending.current.get(id)?.version === sent.version) pending.current.delete(id);
      applyRemote(result);
      succeeded = true;
      if (alive.current) setError("");
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
      if (succeeded && pending.current.size && !saveTimer.current) saveTimer.current = setTimeout(() => { saveTimer.current = null; void flush(); }, 250);
    }
  }, [c.id, applyRemote]);

  const schedule = useCallback(() => {
    if (!saveTimer.current) saveTimer.current = setTimeout(() => { saveTimer.current = null; void flush(); }, 250);
  }, [flush]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.round(1000 * Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))) / 1000, Math.round(1000 * Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))) / 1000];
  }

  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (loading) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event);
    if (erase) {
      // Tap a stroke to remove it — the partner sees it vanish too.
      const target = findStroke(live.current, at, 0.045);
      if (target) {
        edit(target, null);
        setRedo([]);
        haptic("light");
        schedule();
      }
      return;
    }
    drawing.current = { id: crypto.randomUUID(), points: [at] };
    edit(drawing.current.id, { id: drawing.current.id, by: p.id, color, width, points: [...drawing.current.points] });
    setRedo([]);
    schedule();
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const at = point(event);
    const stroke = drawing.current;
    const last = stroke.points.at(-1);
    if (last && Math.hypot(at[0] - last[0], at[1] - last[1]) < 0.004) return;
    if (stroke.points.length >= MAX_POINTS) return;
    stroke.points.push(at);
    const current = live.current.find(item => item.id === stroke.id);
    if (current) edit(stroke.id, { ...current, points: [...stroke.points] });
    schedule();
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = null;
    schedule();
  }

  function undo() {
    const last = live.current.at(-1);
    if (!last) return;
    edit(last.id, null);
    setRedo(list => [...list, last].slice(-40));
    haptic("light");
    schedule();
  }

  function redoLast() {
    const next = redo.at(-1);
    if (!next) return;
    edit(next.id, next);
    setRedo(list => list.slice(0, -1));
    schedule();
  }

  function clear() {
    if (!live.current.length || !window.confirm("Clear the drawing for both of you?")) return;
    // Clearing is reversible on this side; the partner sees a blank canvas.
    setRedo(live.current.slice(-40));
    for (const stroke of live.current) edit(stroke.id, null);
    haptic("success");
    schedule();
  }

  const partner = c.partner;
  async function closeBoard() {
    if (savingRef.current) return;
    if (error && pending.current.size) {
      if (window.confirm("Some changes have not saved. Close anyway?")) onClose();
      return;
    }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (pending.current.size) await flush();
    if (!pending.current.size) onClose();
  }

  return <Modal title="Draw" onClose={() => void closeBoard()} wide>
    <div className="board-wrap">
      <div className="board-head">
        <span className="board-who">{label(p)} <i/> {label(partner)}</span>
        <span className="board-status" role="status">{saving ? <Spinner/> : error ? "Not saved" : "Shared live"}</span>
      </div>
      <div className={"board-canvas" + (erase ? " erasing" : "")}>
        {loading && <div className="board-loading"><Spinner/></div>}
        <canvas ref={canvas} aria-label="Shared drawing canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} style={{ touchAction: "none" }}/>
        {!loading && !strokes.length && <p className="board-hint">Draw together</p>}
      </div>
      <div className="board-tools">
        <div className="board-colors" role="group" aria-label="Ink colour">{COLORS.map(value => <button key={value} aria-label={"Colour " + value} aria-pressed={!erase && color === value} className={!erase && color === value ? "on" : ""} style={{ background: value }} onClick={() => { setColor(value); setErase(false); }}/>)}</div>
        <div className="board-widths" role="group" aria-label="Brush size">{WIDTHS.map(value => <button key={value} aria-label={value + " pixel brush"} aria-pressed={width === value} className={width === value ? "on" : ""} onClick={() => setWidth(value)}><i style={{ width: value + 3, height: value + 3 }}/></button>)}</div>
        <div className="board-actions">
          <IconButton label="Erase a stroke" className={erase ? "selected" : ""} aria-pressed={erase} onClick={() => setErase(!erase)}><Eraser size={19}/></IconButton>
          <IconButton label="Undo" disabled={!strokes.length} onClick={undo}><Undo2 size={19}/></IconButton>
          <IconButton label="Redo" disabled={!redo.length} onClick={redoLast}><Redo2 size={19}/></IconButton>
          <IconButton label="Clear the board" disabled={!strokes.length} onClick={clear}><Trash2 size={19}/></IconButton>
        </div>
      </div>
      <ErrorNote text={error}/>
      {error && <button onClick={() => void flush()}>Retry saving</button>}

    </div>
  </Modal>;
}

/** Nearest stroke to a normalised point, within `radius` of the canvas. */
export function findStroke(strokes: Stroke[], at: Point, radius: number) {
  let best: string | null = null, bestDistance = radius;
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.points.length; i++) {
      const [x, y] = stroke.points[i];
      const [px, py] = stroke.points[Math.max(0, i - 1)];
      const dx = x - px, dy = y - py;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((at[0] - px) * dx + (at[1] - py) * dy) / length)) : 0;
      const distance = Math.hypot(px + t * dx - at[0], py + t * dy - at[1]);
      if (distance < bestDistance) { bestDistance = distance; best = stroke.id; }
    }
  }
  return best;
}
