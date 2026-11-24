"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Maximize2, Mic, MicOff, Minimize2, Music2, Phone, PhoneOff, Signal, Volume2, WifiOff, X } from "lucide-react";
import { attachCallAudio, clearCallAudio, primeCallAudio } from "@/lib/callAudio";
import { buzz, formatDuration, keepAwake } from "@/lib/rtc";
import type { CallSession } from "@/hooks/useCall";
import { title, type Conversation } from "@/lib/types";
import { Avatar, Spinner } from "./UI";
import ListenTogether from "./ListenTogether";

/**
 * Full-screen audio call, iOS-first: a breathing portrait while it rings, then
 * a timer, a live quality meter and a translucent dock. Audio only by design —
 * the same bandwidth buys a wideband voice stream instead of a soft video.
 */
export default function CallSheet({ c, session, remoteAudio, onClose, onUploadAudio }: {
  c: Conversation;
  session: CallSession;
  remoteAudio: RefObject<HTMLAudioElement | null>;
  onClose: () => void;
  onUploadAudio: (file: File) => Promise<void>;
}) {
  const { phase, kind, remote, stats, error, ended, elapsed, muted } = session;
  const screen = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false), [musicLoaded, setMusicLoaded] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(1), [outputError, setOutputError] = useState(""), [level, setLevel] = useState(0);
  const supportsOutput = typeof navigator !== "undefined" && typeof (navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })?.selectAudioOutput === "function" && typeof (HTMLMediaElement.prototype as HTMLMediaElement & { setSinkId?: unknown }).setSinkId === "function";
  const release = useRef<() => void>(() => {});
  const partnerName = title(c) || "your person";
  const connected = phase === "active";
  const clock = formatDuration(elapsed).padStart(5, "0");

  useEffect(() => {
    let active = true;
    void keepAwake().then(fn => { if (active) release.current = fn; else fn(); });
    return () => { active = false; release.current(); };
  }, []);

  useEffect(() => {
    if (remoteAudio.current && remote) { void attachCallAudio(remoteAudio.current, remote, voiceVolume).then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true)); }
    else setAudioBlocked(false);
  }, [remote, remoteAudio]);
  useEffect(() => () => clearCallAudio(remoteAudio.current), [remoteAudio]);

  useEffect(() => { if (remoteAudio.current) remoteAudio.current.volume = voiceVolume; }, [voiceVolume, remote]);

  // Analyze voice activity without feeding microphone or remote audio to output.
  useEffect(() => {
    if ((!remote && !session.local) || typeof AudioContext === "undefined") { setLevel(0); return; }
    let context: AudioContext; let timer: ReturnType<typeof setInterval>;
    try {
      context = new AudioContext(); const sources = [remote, session.local].filter((stream): stream is MediaStream => !!stream && stream.getAudioTracks().length > 0).map(stream => context.createMediaStreamSource(stream)), analyser = context.createAnalyser();
      analyser.fftSize = 256; sources.forEach(source => source.connect(analyser)); const samples = new Uint8Array(analyser.fftSize);
      void context.resume().catch(() => {});
      timer = setInterval(() => { analyser.getByteTimeDomainData(samples); let sum=0; for (const value of samples) sum += ((value-128)/128)**2; setLevel(Math.min(1,Math.sqrt(sum/samples.length)*7)); }, 150);
      return () => { clearInterval(timer); sources.forEach(source => source.disconnect()); void context.close().catch(() => {}); };
    } catch { setLevel(0); }
  }, [remote, session.local]);

  useEffect(() => {
    if (!expanded || !screen.current) return;
    const root=screen.current, previous=document.activeElement as HTMLElement | null;
    root.querySelector<HTMLElement>("button:not(:disabled)")?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{ if(event.key!=="Tab")return; const nodes=[...root.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex=\"0\"]")].filter(node=>node.offsetParent!==null);if(!nodes.length){event.preventDefault();return;}const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};
    document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);if(previous?.isConnected)previous.focus({preventScroll:true});};
  }, [expanded]);

  async function chooseOutput() {
    setOutputError("");
    try {
      const devices = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
      const target = remoteAudio.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
      if (!devices.selectAudioOutput || !target?.setSinkId) throw new Error("Use your device's audio controls to change output.");
      const chosen = await devices.selectAudioOutput(); await target.setSinkId(chosen.deviceId);
    } catch { setOutputError("Use your device's audio controls to change output."); }
  }

  // A gentle two-note ring while waiting, nothing once connected.
  useEffect(() => {
    if (phase !== "ringing" && phase !== "calling") return;
    let cancelled = false;
    let context: AudioContext | null = null;
    const pulse = () => {
      if (cancelled) return;
      buzz(phase === "ringing" ? [220, 120, 220] : [90]);
      try {
        context = context ?? new AudioContext();
        const now = context.currentTime;
        const osc = context.createOscillator(), gain = context.createGain();
        osc.type = "sine"; osc.frequency.value = phase === "ringing" ? 528 : 440;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        osc.connect(gain).connect(context.destination);
        osc.start(now); osc.stop(now + 1);
      } catch { /* audio needs a gesture on some browsers; vibration still fires */ }
    };
    pulse();
    const timer = setInterval(pulse, 2600);
    return () => { cancelled = true; clearInterval(timer); void context?.close().catch(() => {}); };
  }, [phase]);

  useEffect(() => {
    if ((!ended && phase !== "idle") || ended?.status === "failed") return;
    const timer = setTimeout(onClose, ended ? 1600 : 0);
    return () => clearTimeout(timer);
  }, [ended, phase, onClose]);

  const label = ended
    ? ended.status === "declined" ? (ended.mine ? "Call declined" : "Declined") : ended.status === "missed" ? "No answer" : ended.status === "failed" ? "Couldn’t connect" : "Call ended"
    : connected ? clock
    : phase === "calling" ? "Ringing…"
    : phase === "ringing" ? "Voice call"
    : phase === "connecting" ? "Connecting…"
    : "Call";
  void kind;

  return <>
    {!expanded && <button className="call-mini" onClick={() => setExpanded(true)} aria-label="Return to call">
      <span className="call-mini-dot"/><Avatar profile={c.partner} group={c.kind === "group"} size={28}/>
      <strong>{connected ? clock : label}</strong>
      <Maximize2 size={15}/>
    </button>}

  <div ref={screen} style={{ display: expanded ? undefined : "none" }} className={"call-screen audio " + (connected ? "live " : "")} role="dialog" aria-modal="true" aria-label={"Call with " + partnerName}>

    <header className="call-top">
      <button className="call-minimize" aria-label="Collapse call" onClick={() => setExpanded(false)}><Minimize2 size={18}/></button>
      <div className="call-signal" role="status">
        {connected ? <Signal size={13}/> : phase === "connecting" ? <Spinner/> : <WifiOff size={13} className="call-signal-idle"/>}
        <span>{session.fetchingRelay ? "Fetching relay" : connected ? (stats?.path === "relay" ? "Connected • Relay" : stats?.path === "direct" ? "Connected • Direct" : "Connected") : ended?.status === "failed" ? "Failed" : phase === "connecting" ? "Connecting" : label}</span>
      </div>
      {connected && stats && <span className="call-quality" title={"Round-trip " + stats.rtt + " ms"}>
        <b style={{ width: Math.max(12, Math.min(100, 100 - Math.min(100, stats.loss * 14) - Math.min(70, stats.rtt / 6))) + "%" }}/>
      </span>}
    </header>

    <div className="call-stage">
      <span className={"call-rings " + (phase === "ringing" || phase === "calling" ? "ringing" : "")} style={{ "--voice-level": level } as React.CSSProperties}/>
      <div className={"call-portrait " + (connected ? "speaking" : "")}>
        <Avatar profile={c.partner} group={c.kind === "group"} size={126}/>
        {c.partner?.mood && <span className="call-mood" aria-hidden="true">{c.partner.mood}</span>}
      </div>
      <h1 className="call-name">{partnerName}</h1>
      <p className={"call-state " + (connected ? "live" : "")}>{label}</p>
      {phase === "connecting" && !session.fetchingRelay && <button className="call-audio-retry" onClick={session.retryConnection}>Retry connection</button>}
      {audioBlocked && <button className="call-audio-retry" onClick={() => void remoteAudio.current?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))}>Tap to hear audio</button>}
      {error && <p className="call-error" role="alert">{error}</p>}
      {ended?.status === "failed" && /call is already in progress/i.test(error) && <button className="call-audio-retry" onClick={() => void session.endPreviousCall().then(ok => { if (ok) onClose(); })}>End previous call</button>}
    </div>

    {phase === "ringing" ? <div className="call-actions incoming">
      <button className="call-action decline" aria-label="Decline call" onClick={() => void session.decline()}><PhoneOff size={26}/><small>Decline</small></button>
      <button className="call-action accept" aria-label="Accept call" onClick={() => { primeCallAudio(remoteAudio.current); void session.accept(); }}><Phone size={26}/><small>Accept</small></button>
    </div> : <div className="call-actions">
      <button className={"call-action " + (muted ? "on" : "")} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} onClick={session.toggleMute}>{muted ? <MicOff size={24}/> : <Mic size={24}/>}<small>{muted ? "Unmute" : "Mute"}</small></button>
      <button className="call-action" aria-label="Audio output" disabled={!supportsOutput || !connected} onClick={() => void chooseOutput()}><Volume2 size={24}/><small>Output</small></button>
      <button className="call-action" aria-label="Share music" disabled={!connected} onClick={() => { setMusicLoaded(true); setMusicOpen(true); }}><Music2 size={24}/><small>Music</small></button>
      <button className="call-action" aria-label="Minimise call" onClick={() => setExpanded(false)}><Minimize2 size={24}/><small>Minimise</small></button>
      <button className="call-action end" aria-label="End call" onClick={() => { if (ended?.status === "failed") onClose(); else void session.hangup(); }}><PhoneOff size={26}/><small>End</small></button>
    </div>}

    {(outputError || !supportsOutput) && connected && <p className="call-output-note" role="status">{outputError || "Use your device controls to change audio output."}</p>}
    {musicLoaded && <div className="call-music-drawer" hidden={!musicOpen}>
      <header><h2>Listen together</h2><button aria-label="Close music" onClick={() => setMusicOpen(false)}><X size={20}/></button></header>
      <label className="listen-slider">Voice volume<input type="range" min="0" max="1" step="0.05" value={voiceVolume} aria-label="Voice volume" onChange={event => setVoiceVolume(Number(event.target.value))}/></label>
      <ListenTogether c={c} onUploadAudio={onUploadAudio} voiceLevel={level}/>
    </div>}
    <div className="call-home-indicator" aria-hidden="true"/>
  </div></>;
}
