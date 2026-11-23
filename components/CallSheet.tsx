"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Signal, Volume2, VolumeX, WifiOff } from "lucide-react";
import { buzz, formatDuration, keepAwake } from "@/lib/rtc";
import type { CallSession } from "@/hooks/useCall";
import { title, type Conversation } from "@/lib/types";
import { Avatar, Spinner } from "./UI";

/**
 * Full-screen audio call, iOS-first: a breathing portrait while it rings, then
 * a timer, a live quality meter and a translucent dock. Audio only by design —
 * the same bandwidth buys a wideband voice stream instead of a soft video.
 */
export default function CallSheet({ c, session, onClose }: {
  c: Conversation;
  session: CallSession;
  onClose: () => void;
}) {
  const { phase, kind, remote, stats, error, ended, elapsed, muted, speaker } = session;
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const [expanded, setExpanded] = useState(true);
  const release = useRef<() => void>(() => {});
  const partnerName = title(c) || "your person";
  const connected = phase === "active";

  useEffect(() => {
    void keepAwake().then(fn => { release.current = fn; });
    return () => { release.current(); };
  }, []);

  useEffect(() => {
    if (remoteAudio.current && remote) { remoteAudio.current.srcObject = remote; void remoteAudio.current.play().catch(() => {}); }
  }, [remote]);

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
    if (!ended && phase !== "idle") return;
    const timer = setTimeout(onClose, ended ? 1600 : 0);
    return () => clearTimeout(timer);
  }, [ended, phase, onClose]);

  const label = ended
    ? ended.status === "declined" ? (ended.mine ? "Call declined" : "Declined") : ended.status === "missed" ? "No answer" : ended.status === "failed" ? "Couldn’t connect" : "Call ended"
    : connected ? formatDuration(elapsed)
    : phase === "calling" ? "Ringing…"
    : phase === "ringing" ? "Voice call"
    : phase === "connecting" ? "Connecting…"
    : "Call";
  void kind;

  return <>
    {!expanded && <button className="call-mini" onClick={() => setExpanded(true)} aria-label="Return to call">
      <span className="call-mini-dot"/><Avatar profile={c.partner} group={c.kind === "group"} size={28}/>
      <strong>{connected ? formatDuration(elapsed) : label}</strong>
      <Maximize2 size={15}/>
    </button>}

  <div style={{ display: expanded ? undefined : "none" }} className={"call-screen audio " + (connected ? "live " : "")} role="dialog" aria-modal="true" aria-label={"Call with " + partnerName}>
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

    <div className="call-stage">
      <span className={"call-rings " + (phase === "ringing" || phase === "calling" ? "ringing" : "")}/>
      <div className={"call-portrait " + (connected ? "speaking" : "")}>
        <Avatar profile={c.partner} group={c.kind === "group"} size={126}/>
        {c.partner?.mood && <span className="call-mood" aria-hidden="true">{c.partner.mood}</span>}
      </div>
      <h1 className="call-name">{partnerName}</h1>
      <p className={"call-state " + (connected ? "live" : "")}>{label}</p>
      {connected && stats && <p className="call-detail">{stats.bitrate ? Math.round(stats.bitrate / 1000) + " kbps" : "wideband audio"} · {stats.loss ? stats.loss + "% loss" : "clear"}</p>}
      {error && <p className="call-error" role="alert">{error}</p>}
    </div>

    {phase === "ringing" ? <div className="call-actions incoming">
      <button className="call-action decline" aria-label="Decline call" onClick={() => void session.decline()}><PhoneOff size={26}/><small>Decline</small></button>
      <button className="call-action accept" aria-label="Accept call" onClick={() => void session.accept()}><Phone size={26}/><small>Accept</small></button>
    </div> : <div className="call-actions">
      <button className={"call-action " + (muted ? "on" : "")} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} onClick={session.toggleMute}>{muted ? <MicOff size={24}/> : <Mic size={24}/>}<small>{muted ? "Unmute" : "Mute"}</small></button>
      {typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && <button className={"call-action " + (speaker ? "on" : "")} aria-pressed={speaker} aria-label={speaker ? "Speaker off" : "Speaker on"} onClick={() => session.setSpeaker(!speaker)}>{speaker ? <Volume2 size={24}/> : <VolumeX size={24}/>}<small>Speaker</small></button>}
      <button className="call-action end" aria-label="End call" onClick={() => void session.hangup()}><PhoneOff size={26}/><small>End</small></button>
    </div>}

    <p className="call-privacy">Peer-to-peer voice · nothing is recorded</p>
  </div></>;
}
