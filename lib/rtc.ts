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

export type CallKind = "audio" | "video";
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
  | { type: "bye"; from: string; reason?: string };

/** Free STUN keeps most home networks connected; a TURN server can be added by
 *  setting NEXT_PUBLIC_TURN_URL / NEXT_PUBLIC_TURN_USER / NEXT_PUBLIC_TURN_PASS. */
export function iceServers(): RTCIceServer[] {
  // Device-local relay first (it is the only path that survives carrier NAT),
  // then an optional build-time relay, then the public STUN pool.
  const servers: RTCIceServer[] = [...relay(), ...BASE_ICE];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) {
    servers.push({
      urls: url.split(",").map(value => value.trim()).filter(Boolean),
      username: process.env.NEXT_PUBLIC_TURN_USER || undefined,
      credential: process.env.NEXT_PUBLIC_TURN_PASS || undefined,
    });
  }
  return servers;
}

export function mediaSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "RTCPeerConnection" in window;
}

export async function openMedia(kind: CallKind): Promise<MediaStream> {
  if (!mediaSupported()) throw new Error("This browser cannot make calls.");
  const constraints: MediaStreamConstraints = kind === "video"
    ? {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      }
    : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (cause) {
    const name = (cause as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new Error(kind === "video" ? "Camera and microphone are blocked. Allow them in your browser to call." : "Microphone is blocked. Allow it in your browser to call.");
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      // Falling back to audio keeps a video call usable on devices without a camera.
      if (kind === "video") {
        if (name === "NotFoundError") throw new Error("No camera or microphone was found on this device.");
        try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } }); } catch { /* fall through */ }
      }
      throw new Error("No microphone was found on this device.");
    }
    if (name === "NotReadableError") throw new Error("Another app is using your camera or microphone.");
    throw new Error("Could not start the call on this device.");
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => { try { track.stop(); } catch {} });
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

export type CallStats = { bitrate: number; rtt: number; loss: number; width: number; height: number; codec: string };

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
  remoteOpenedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private handlers: Handlers, private selfId: string) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers(), iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" });
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
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === "failed") { try { this.pc.restartIce(); } catch {} }
    };
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
    const description = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await this.pc.setLocalDescription(description);
    return this.pc.localDescription!;
  }

  async answer(offer: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(offer);
    await this.flush();
    const description = await this.pc.createAnswer();
    await this.pc.setLocalDescription(description);
    return this.pc.localDescription!;
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
        this.handlers.onStats?.({
          bitrate,
          rtt: pair?.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : 0,
          loss: total ? Math.round(((inbound?.packetsLost ?? 0) / total) * 1000) / 10 : 0,
          width: inbound?.frameWidth ?? 0,
          height: inbound?.frameHeight ?? 0,
          codec: inbound?.codecId ?? "",
        });
      } catch { /* stats are cosmetic */ }
    }, 2000);
  }

  /** Swap the camera for a front/back facing one without renegotiating the call. */
  async flipCamera(stream: MediaStream) {
    if (!navigator.mediaDevices?.getUserMedia) return stream;
    const current = stream.getVideoTracks()[0];
    const facing = current?.getSettings().facingMode === "environment" ? "user" : "environment";
    const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const track = next.getVideoTracks()[0];
    const sender = this.pc.getSenders().find(item => item.track?.kind === "video");
    if (sender && track) await sender.replaceTrack(track);
    current?.stop();
    stream.removeTrack(current);
    if (track) stream.addTrack(track);
    return stream;
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
