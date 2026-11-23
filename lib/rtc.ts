/**
 * WebRTC plumbing for BitchAt calls.
 *
 * Signaling never touches the peer directly: every offer/answer/candidate is
 * relayed by the `call_signal()` database function into the private
 * `call:<conversation>` broadcast topic, so a client can only ever signal a
 * call it belongs to. Media is peer-to-peer (DTLS-SRTP), never recorded and
 * never stored by us.
 */

import { BASE_ICE, relay } from "./turn";
import { endpoint } from "./supabase";

/** Calls are audio-only in 2.13: the video path was removed on purpose. */
export type CallKind = "audio";
export type CallStatus = "ringing" | "active" | "declined" | "missed" | "ended" | "failed";

export type CallRow = {
  id: string;
  conversation_id: string;
  caller: string;
  callee: string | null;
  kind: CallKind;
  status: CallStatus;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  ended_by?: string | null;
  seconds?: number;
};

export type Signal =
  | { type: "offer"; sdp: string; from: string; kind?: CallKind }
  | { type: "answer"; sdp: string; from: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit; from: string }
  | { type: "ready"; from: string }
  | { type: "restart"; from: string }
  | { type: "bye"; from: string; reason?: string };

/** Manual per-device relay is an override; Cloudflare credentials are issued per call. */
export function iceServers(): RTCIceServer[] { return [...relay(), ...BASE_ICE]; }

export async function callIceServers(callId: string): Promise<RTCIceServer[]> {
  const manual = relay();
  if (manual.length) return [...manual, ...BASE_ICE];
  const response = await endpoint("turn-credentials", { callId });
  const data = await response.json() as { iceServers?: RTCIceServer[] };
  if (!Array.isArray(data.iceServers) || !data.iceServers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => typeof url === "string" && /^turns?:/i.test(url)) && typeof server.username === "string" && typeof server.credential === "string")) throw new Error("Call relay unavailable. Please try again.");
  return [...data.iceServers, ...BASE_ICE];
}

export function mediaSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "RTCPeerConnection" in window;
}

/**
 * Call audio only. Voice is the point: the same bandwidth that would carry a
 * 360p video frame instead carries a wideband, echo-cancelled audio stream, so
 * the call holds up on a weak signal and never asks for the camera.
 */
export async function openMedia(): Promise<MediaStream> {
  if (!mediaSupported()) throw new Error("This browser cannot make calls.");
  // Prefer 48 kHz, stereo-capable voice with the OS echo canceller on.
  const preferred: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: preferred, video: false });
  } catch (cause) {
    const name = (cause as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new Error("Microphone is blocked. Allow it in your browser to make a call.");
    if (name === "OverconstrainedError") {
      // Some phones reject the sample-rate hints; plain audio still works.
      try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); } catch { /* fall through */ }
    }
    if (name === "NotFoundError") throw new Error("No microphone was found on this device.");
    if (name === "NotReadableError") throw new Error("Another app is using your microphone.");
    throw new Error("Could not start the call on this device.");
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => { try { track.stop(); } catch {} });
}

/** Prefer Opus and update its format parameters without changing other codecs. */
export function preferOpus(sdp: string): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const start = lines.findIndex(line => line.startsWith("m=audio "));
  if (start < 0) return sdp;
  let end = lines.findIndex((line, index) => index > start && line.startsWith("m="));
  if (end < 0) end = lines.length;
  const match = lines.slice(start, end).map(line => /^a=rtpmap:(\d+) opus\/48000(?:\/\d+)?$/i.exec(line)).find(Boolean);
  if (!match) return sdp;
  const payload = match[1], media = lines[start].split(" ");
  if (media.slice(3).includes(payload)) lines[start] = [...media.slice(0, 3), payload, ...media.slice(3).filter(value => value !== payload)].join(" ");
  const fmtpIndex = lines.findIndex((line, index) => index > start && index < end && line.startsWith("a=fmtp:" + payload + " "));
  const params = fmtpIndex < 0 ? [] : lines[fmtpIndex].slice(("a=fmtp:" + payload + " ").length).split(";").map(value => value.trim()).filter(Boolean);
  const replacements: Record<string,string> = { maxaveragebitrate: "64000", stereo: "1", "sprop-stereo": "1", usedtx: "0" };
  const filtered = params.filter(param => !(param.split("=")[0].toLowerCase() in replacements));
  const line = "a=fmtp:" + payload + " " + [...filtered, ...Object.entries(replacements).map(([key,value]) => key + "=" + value)].join(";");
  if (fmtpIndex >= 0) lines[fmtpIndex] = line; else lines.splice(start + 1, 0, line);
  return lines.join(eol);
}

/** Human text for a call that never connected. */
export function callLabel(row: Pick<CallRow, "status" | "answered_at" | "ended_at" | "started_at">) {
  if (row.status === "missed") return "Missed";
  if (row.status === "declined") return "Declined";
  if (row.status === "failed") return "Couldn’t connect";
  if (row.status === "ringing") return "Ringing…";
  const end = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
  const start = row.answered_at ? new Date(row.answered_at).getTime() : new Date(row.started_at).getTime();
  return formatDuration(Math.max(0, Math.round((end - start) / 1000)));
}

export function formatDuration(total: number) {
  const safe = Number.isFinite(total) ? total : 0;
  const seconds = Math.max(0, Math.floor(safe));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = seconds % 60;
  return hours ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0") : minutes + ":" + String(rest).padStart(2, "0");
}

type Handlers = {
  onSignal: (signal: Signal) => void;
  onState: (state: RTCPeerConnectionState) => void;
  onRemote: (stream: MediaStream) => void;
  onStats?: (stats: CallStats) => void;
};

export type CallStats = { bitrate: number; rtt: number; loss: number; width: number; height: number; codec: string; path?: "relay" | "direct" | "unknown" };

/**
 * One call leg. Owns the RTCPeerConnection, buffers candidates until the
 * remote description exists, and reports a lightweight stats snapshot.
 */
export class CallLink {
  private pc: RTCPeerConnection;
  private remote = new MediaStream();
  private pending: RTCIceCandidateInit[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytes = 0;
  private lastAt = 0;
  private closed = false;
  private offerFlight: Promise<RTCSessionDescription> | null = null;
  private answerFlight: Promise<RTCSessionDescription> | null = null;
  remoteOpenedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private handlers: Handlers, private selfId: string, servers: RTCIceServer[] = iceServers()) {
    this.pc = new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" });
    this.pc.onicecandidate = event => {
      if (event.candidate) handlers.onSignal({ type: "candidate", candidate: event.candidate.toJSON(), from: selfId });
    };
    this.pc.ontrack = event => {
      const [stream] = event.streams;
      if (stream) {
        this.remote = stream;
      } else {
        this.remote.addTrack(event.track);
      }
      handlers.onRemote(this.remote);
    };
    this.pc.onconnectionstatechange = () => handlers.onState(this.pc.connectionState);

  }

  addLocal(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      const existing = this.pc.getSenders().find(sender => sender.track?.kind === track.kind);
      if (existing) void existing.replaceTrack(track); else this.pc.addTrack(track, stream);
    }
  }

  /** True once we have produced a local description, so a duplicate `ready`
   *  from the callee cannot trigger a second, conflicting offer. */
  hasLocalDescription() {
    return !!this.pc.currentLocalDescription || !!this.pc.localDescription;
  }

  async offer() {
    const existing = this.pc.localDescription;
    if (existing?.type === "offer") return existing;
    if (this.offerFlight) return this.offerFlight;
    this.offerFlight = (async () => {
      const description = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await this.pc.setLocalDescription({ type: description.type, sdp: description.sdp ? preferOpus(description.sdp) : description.sdp });
      return this.pc.localDescription!;
    })();
    try { return await this.offerFlight; } finally { this.offerFlight = null; }
  }

  signalingStable() { return this.pc.signalingState === "stable"; }

  /** The caller alone creates restart offers, avoiding simultaneous-offer glare. */
  async restartOffer() {
    if (this.offerFlight) return this.offerFlight;
    if (this.pc.signalingState !== "stable") return this.pc.localDescription?.type === "offer" ? this.pc.localDescription : null;
    this.offerFlight = (async () => {
      const description = await this.pc.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: false });
      await this.pc.setLocalDescription({ type: description.type, sdp: description.sdp ? preferOpus(description.sdp) : description.sdp });
      return this.pc.localDescription!;
    })();
    try { return await this.offerFlight; } finally { this.offerFlight = null; }
  }

  async answer(offer: RTCSessionDescriptionInit) {
    if (this.answerFlight) return this.answerFlight;
    if (this.pc.remoteDescription?.sdp === offer.sdp && this.pc.localDescription?.type === "answer") return this.pc.localDescription;
    this.answerFlight = (async () => {
      await this.pc.setRemoteDescription(offer);
      await this.flush();
      const description = await this.pc.createAnswer();
      await this.pc.setLocalDescription({ type: description.type, sdp: description.sdp ? preferOpus(description.sdp) : description.sdp });
      return this.pc.localDescription!;
    })();
    try { return await this.answerFlight; } finally { this.answerFlight = null; }
  }

  async accept(description: RTCSessionDescriptionInit) {
    if (this.pc.signalingState === "stable" && this.pc.remoteDescription) return;
    await this.pc.setRemoteDescription(description);
    await this.flush();
  }

  async candidate(candidate: RTCIceCandidateInit) {
    if (!this.pc.remoteDescription || this.pc.remoteDescription.type === undefined) { this.pending.push(candidate); return; }
    try { await this.pc.addIceCandidate(candidate); } catch { /* a stale candidate is harmless */ }
  }

  private async flush() {
    const queued = this.pending.splice(0);
    for (const candidate of queued) { try { await this.pc.addIceCandidate(candidate); } catch {} }
  }

  startStats() {
    if (this.statsTimer) return;
    this.lastAt = Date.now();
    this.statsTimer = setInterval(async () => {
      if (this.closed) return;
      try {
        const report = await this.pc.getStats();
        let inbound: any = null, pair: any = null;
        report.forEach((entry: any) => {
          if (entry.type === "inbound-rtp" && (entry.kind === "audio" || entry.kind === "video")) inbound = entry;
          if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated) pair = entry;
        });
        const bytes = inbound?.bytesReceived ?? 0, now = Date.now();
        const elapsed = Math.max(1, now - this.lastAt);
        const bitrate = this.lastAt ? Math.max(0, Math.round(((bytes - this.lastBytes) * 8) / elapsed)) : 0;
        this.lastBytes = bytes; this.lastAt = now;
        const total = (inbound?.packetsReceived ?? 0) + (inbound?.packetsLost ?? 0);
        const localType = pair ? report.get(pair.localCandidateId)?.candidateType : null;
        const remoteType = pair ? report.get(pair.remoteCandidateId)?.candidateType : null;
        this.handlers.onStats?.({
          bitrate,
          rtt: pair?.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : 0,
          loss: total ? Math.round(((inbound?.packetsLost ?? 0) / total) * 1000) / 10 : 0,
          width: inbound?.frameWidth ?? 0,
          height: inbound?.frameHeight ?? 0,
          codec: inbound?.codecId ?? "",
          path: localType === "relay" || remoteType === "relay" ? "relay" : localType && remoteType ? "direct" : "unknown",
        });
      } catch { /* stats are cosmetic */ }
    }, 2000);
  }

  close() {
    this.closed = true;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    try { this.pc.close(); } catch {}
  }
}

/** A phone buzz for incoming calls where the Web Notifications API is allowed. */
export function buzz(pattern: number | number[] = [90, 60, 90]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

/** Keep the screen awake during a call where the platform allows it. */
export async function keepAwake(): Promise<() => void> {
  const wakelock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
  if (!wakelock) return () => {};
  try {
    const lock = await wakelock.request("screen");
    return () => { void lock.release().catch(() => {}); };
  } catch { return () => {}; }
}
