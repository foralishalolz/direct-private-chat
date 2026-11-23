"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Signal, SwitchCamera, Video, VideoOff, Volume2, VolumeX, WifiOff } from "lucide-react";
import { buzz, formatDuration, keepAwake, type CallKind } from "@/lib/rtc";
import type { CallSession } from "@/hooks/useCall";
import { title, type Conversation, type Profile } from "@/lib/types";
import { Avatar, Spinner } from "./UI";

/**
 * Full-screen call surface, iOS-first: a centred avatar with a soft breathing
 * ring while ringing, then a timer, a translucent control dock, and the
 * partner's video full-bleed with a draggable self-preview.
 */
export default function CallSheet({ c, session, onClose }: {
  c: Conversation;
  session: CallSession;
  onClose: () => void;
}) {
  const { phase, outgoing, kind, local, remote, stats, error, ended, elapsed, muted, cameraOff, speaker } = session;
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const [pip, setPip] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ id: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const release = useRef<() => void>(() => {});

  const partnerName = title(c) || "your person";
  const callKind: CallKind = kind;
  const connected = phase === "active";

  useEffect(() => {
    void keepAwake().then(fn => { release.current = fn; });
    return () => { release.current(); };
  }, []);

  useEffect(() => {
    if (localVideo.current && local) localVideo.current.srcObject = local;
  }, [local, cameraOff]);

  useEffect(() => {
    if (remoteVideo.current && remote) { remoteVideo.current.srcObject = remote; void remoteVideo.current.play().catch(() => {}); }
    if (remoteAudio.current && remote) { remoteAudio.current.srcObject = remote; void remoteAudio.current.play().catch(() => {}); }
  }, [remote]);

  // Ringtone: a gentle two-note pulse while the call is ringing, silent otherwise.
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

  // Someone accepting or hanging up ends the surface after a short beat so the
  // "Call ended" line is readable.
  useEffect(() => {
    if (!ended && phase !== "idle") return;
    const timer = setTimeout(onClose, ended ? 1600 : 0);
    return () => clearTimeout(timer);
  }, [ended, phase, onClose]);

  const label = ended
    ? ended.status === "declined" ? (ended.mine ? "Call declined" : "Declined") : ended.status === "missed" ? "No answer" : ended.status === "failed" ? "Couldn’t connect" : "Call ended"
    : connected ? formatDuration(elapsed)
    : phase === "calling" ? "Ringing…"
    : phase === "ringing" ? (callKind === "video" ? "Video call" : "Incoming call")
    : phase === "connecting" ? "Connecting…"
    : "Call";

  if (!expanded) {
    return <button className="call-mini" onClick={() => setExpanded(true)} aria-label="Return to call">
      <span className="call-mini-dot"/><Avatar profile={c.partner} group={c.kind === "group"} size={28}/>
      <strong>{connected ? formatDuration(elapsed) : label}</strong>
      <Maximize2 size={15}/>
    </button>;
  }

  return <div className={"call-screen " + (connected ? "live " : "") + callKind} role="dialog" aria-modal="true" aria-label={"Call with " + partnerName}>
    {kind === "video" && <div className="call-video-layer" aria-hidden={!connected}>
      <video ref={remoteVideo} className={"call-remote " + (connected ? "visible" : "")} playsInline autoPlay muted={false}/>
      {!connected && <div className="call-video-placeholder"><span className="call-rings"/><Avatar profile={c.partner} group={c.kind === "group"} size={116}/></div>}
    </div>}
    <audio ref={remoteAudio} autoPlay playsInline/>

    <header className="call-top">
      <button className="call-minimize" aria-label="Minimise call" onClick={() => setExpanded(false)}><Minimize2 size={18}/></button>
      <div className="call-signal" role="status">
        {connected ? <Signal size={13}/> : phase === "connecting" ? <Spinner/> : <WifiOff size={13} className="call-signal-idle"/>}
        <span>{connected ? (stats ? Math.round(stats.rtt) + " ms" : "Connected") : label}</span>
      </div>
      {connected && stats && <span className="call-quality" title={"Round-trip " + stats.rtt + " ms"}>
        <b style={{ width: Math.max(12, Math.min(100, 100 - Math.min(100, stats.loss * 14) - Math.min(70, stats.rtt / 6))) + "%" }}/>
      </span>}
    </header>

    <div className={"call-stage " + (kind === "video" && connected ? "with-video" : "")}>
      {!(kind === "video" && connected) && <>
        <span className={"call-rings " + (phase === "ringing" || phase === "calling" ? "ringing" : "")}/>
        <div className="call-portrait"><Avatar profile={c.partner} group={c.kind === "group"} size={126}/>{c.partner?.mood && <span className="call-mood" aria-hidden="true">{c.partner.mood}</span>}</div>
      </>}
      {!(kind === "video" && connected) && <h1 className="call-name">{partnerName}</h1>}
      <p className={"call-state " + (connected ? "live" : "")}>{label}</p>
      {connected && stats && <p className="call-detail">{stats.bitrate ? Math.round(stats.bitrate / 1000) + " kbps" : "audio"} · {stats.loss ? stats.loss + "% loss" : "clear"}{kind === "video" && stats.height ? " · " + stats.height + "p" : ""}</p>}
      {error && <p className="call-error" role="alert">{error}</p>}
    </div>

    {kind === "video" && connected && local && <div
      className="call-self"
      style={{ transform: `translate(${pip.x}px, ${pip.y}px)` }}
      onPointerDown={event => {
        if (!event.isPrimary) return;
        setDrag({ id: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: pip.x, baseY: pip.y });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag || drag.id !== event.pointerId) return;
        const x = Math.max(-window.innerWidth + 130, Math.min(window.innerWidth - 130, drag.baseX + event.clientX - drag.startX));
        const y = Math.max(-window.innerHeight + 260, Math.min(window.innerHeight - 260, drag.baseY + event.clientY - drag.startY));
        setPip({ x, y });
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      aria-label="Your camera"
    >
      <video ref={localVideo} playsInline autoPlay muted className={cameraOff ? "off" : ""}/>
      {cameraOff && <span className="call-self-off"><VideoOff size={20}/></span>}
    </div>}

    {phase === "ringing" ? <div className="call-actions incoming">
      <button className="call-action decline" aria-label="Decline call" onClick={() => void session.decline()}><PhoneOff size={26}/><small>Decline</small></button>
      <button className="call-action accept" aria-label="Accept call" onClick={() => void session.accept()}><Phone size={26}/><small>Accept</small></button>
    </div> : <div className="call-actions">
      <button className={"call-action " + (muted ? "on" : "")} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} onClick={session.toggleMute}>{muted ? <MicOff size={24}/> : <Mic size={24}/>}<small>{muted ? "Unmute" : "Mute"}</small></button>
      {kind === "video" && <>
        <button className={"call-action " + (cameraOff ? "on" : "")} aria-pressed={cameraOff} aria-label={cameraOff ? "Turn camera on" : "Turn camera off"} onClick={session.toggleCamera}>{cameraOff ? <VideoOff size={24}/> : <Video size={24}/>}<small>{cameraOff ? "Camera on" : "Camera off"}</small></button>
        <button className="call-action" aria-label="Flip camera" onClick={() => void session.flip()}><SwitchCamera size={24}/><small>Flip</small></button>
      </>}
      <button className={"call-action " + (speaker ? "on" : "")} aria-pressed={speaker} aria-label={speaker ? "Speaker off" : "Speaker on"} onClick={() => session.setSpeaker(!speaker)}>{speaker ? <Volume2 size={24}/> : <VolumeX size={24}/>}<small>Speaker</small></button>
      <button className="call-action end" aria-label="End call" onClick={() => void session.hangup()}><PhoneOff size={26}/><small>End</small></button>
    </div>}

    <p className="call-privacy">Peer-to-peer · nothing is recorded</p>
  </div>;
}
