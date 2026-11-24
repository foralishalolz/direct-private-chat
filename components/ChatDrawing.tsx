"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Pen, Send, Sparkles, Undo2, X } from "lucide-react";
import { errorText } from "@/lib/types";

type Point = [number, number];
type Mark = { points: Point[]; color: string; width: number; tool: "pen" | "glow" | "eraser" };
const COLORS = ["#ffffff", "#3999f3", "#70c95c", "#ffca49", "#ff9143", "#f04e65", "#d80083", "#b9b5ff"];

/** A transparent drawing over the current chat. Only ink is exported: chat
 * messages, names, photos, and other underlying pixels are never captured. */
export default function ChatDrawing({ onClose, onSend }: { onClose: () => void; onSend: (ink: Blob) => Promise<void> }) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const marks = useRef<Mark[]>([]), current = useRef<Mark | null>(null), pointer = useRef<number | null>(null);
  const [count, setCount] = useState(0), [tool, setTool] = useState<Mark["tool"]>("glow");
  const [color, setColor] = useState(COLORS[0]), [width, setWidth] = useState(8), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const busyRef = useRef(false);
  const paint = useCallback(() => {
    const node = canvas.current; if (!node) return;
    const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio);
    if (node.width !== w || node.height !== h) { node.width = w; node.height = h; }
    const ctx = node.getContext("2d"); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const mark of marks.current) {
      ctx.globalCompositeOperation = mark.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = mark.width;
      ctx.shadowColor = mark.tool === "glow" ? mark.color : "transparent";
      ctx.shadowBlur = mark.tool === "glow" ? mark.width * 3 : 0;
      ctx.beginPath();
      mark.points.forEach(([x,y], index) => { if (index) ctx.lineTo(x * rect.width,y * rect.height); else ctx.moveTo(x * rect.width,y * rect.height); });
      if (mark.points.length === 1) { const [x,y] = mark.points[0]; ctx.arc(x * rect.width,y * rect.height,mark.width / 2,0,Math.PI * 2); ctx.fill(); }
      else ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalCompositeOperation = "source-over";
  }, []);
  useEffect(() => { const observer = new ResizeObserver(paint); if (canvas.current) observer.observe(canvas.current); paint(); return () => observer.disconnect(); }, [paint]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); close(); }
      if (event.key !== "Tab" || !root.current) return;
      const nodes = [...root.current.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)")].filter(el => el.offsetParent !== null);
      const first=nodes[0],last=nodes.at(-1); if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus({preventScroll:true}); };
    // This listener intentionally follows the mounted editor, not tool changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function close() { if (busyRef.current) return; if (marks.current.length && !window.confirm("Discard this drawing?")) return; onClose(); }
  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect=event.currentTarget.getBoundingClientRect();
    return [Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width)),Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height))];
  }
  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (busyRef.current || pointer.current !== null || !event.isPrimary || event.pointerType === "mouse" && event.button !== 0 || marks.current.length >= 200) return;
    event.currentTarget.setPointerCapture(event.pointerId); pointer.current=event.pointerId;
    current.current={points:[point(event)],color,width:tool === "eraser" ? width * 3 : width,tool}; marks.current.push(current.current); setCount(marks.current.length); paint();
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId || !current.current || current.current.points.length >= 1500) return;
    const next=point(event),last=current.current.points.at(-1)!; if (Math.hypot(next[0]-last[0],next[1]-last[1]) < .001) return;
    current.current.points.push(next); paint();
  }
  function up(event: React.PointerEvent<HTMLCanvasElement>) { if (pointer.current === event.pointerId) { pointer.current=null; current.current=null; } }
  async function send() {
    if (busyRef.current || !marks.current.length || !canvas.current) return;
    busyRef.current=true; setBusy(true); setError("");
    try {
      // Constrain the encoded image while preserving transparency.
      const source=canvas.current, scale=Math.min(1,1600/Math.max(source.width,source.height));
      const output=document.createElement("canvas"); output.width=Math.max(1,Math.round(source.width*scale)); output.height=Math.max(1,Math.round(source.height*scale));
      const ctx=output.getContext("2d"); if (!ctx) throw new Error("Drawing unavailable."); ctx.drawImage(source,0,0,output.width,output.height);
      const blob=await new Promise<Blob>((resolve,reject)=>output.toBlob(value=>value ? resolve(value) : reject(new Error("Could not prepare drawing.")),"image/png"));
      await onSend(blob); onClose();
    } catch (cause) { setError(errorText(cause)); }
    finally { busyRef.current=false; setBusy(false); }
  }
  return <div className="chat-draw-overlay" ref={root} role="dialog" aria-modal="true" aria-label="Draw on chat">
    <canvas ref={canvas} aria-label="Draw over conversation" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}/>
    <div className="chat-draw-top" role="group" aria-label="Drawing tools">
      <button aria-label="Pen" aria-pressed={tool === "pen"} onClick={()=>setTool("pen")}><Pen size={20}/></button>
      <button aria-label="Glow pen" aria-pressed={tool === "glow"} onClick={()=>setTool("glow")}><Sparkles size={20}/></button>
      <button aria-label="Eraser" aria-pressed={tool === "eraser"} onClick={()=>setTool("eraser")}><Eraser size={20}/></button>
    </div>
    <label className="chat-draw-size"><span>Size</span><input type="range" aria-label="Brush size" min="2" max="24" value={width} onChange={event=>setWidth(Number(event.target.value))}/></label>
    {!count && <div className="chat-draw-hint">Draw something ✨<small>Only your drawing is sent, not the chat behind it.</small></div>}
    <div className="chat-draw-bottom">
      <button className="draw-circle" aria-label="Close drawing" disabled={busy} onClick={close}><X size={22}/></button>
      <button className="draw-circle" aria-label="Undo drawing" disabled={!count || busy} onClick={()=>{marks.current.pop();setCount(marks.current.length);paint();}}><Undo2 size={22}/></button>
      <div className="chat-draw-colors" role="group" aria-label="Ink colour">{COLORS.map(value=><button key={value} aria-label={"Colour "+value} aria-pressed={color===value && tool!=="eraser"} style={{"--draw-color":value} as React.CSSProperties} onClick={()=>{setColor(value);if(tool==="eraser")setTool("pen");}}/>)}</div>
      <button className="draw-circle draw-send" aria-label="Send drawing" disabled={!count||busy} onClick={()=>void send()}><Send size={21}/></button>
    </div>
    {error && <div className="chat-draw-error" role="alert">{error}</div>}
  </div>;
}
