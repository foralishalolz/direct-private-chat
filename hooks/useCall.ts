import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db, rpc } from "@/lib/supabase";
import { CallLink, openMedia, type CallKind, type CallRow, type CallStats, type Signal } from "@/lib/rtc";

type Phase = "idle" | "calling" | "ringing" | "connecting" | "active";
type EndedStatus = "declined" | "missed" | "ended" | "failed";

export type CallSession = {
  phase: Phase;
  call: CallRow | null;
  outgoing: boolean;
  kind: CallKind;
  local: MediaStream | null;
  remote: MediaStream | null;
  stats: CallStats | null;
  error: string;
  ended: { status: EndedStatus; mine: boolean } | null;
  muted: boolean;
  cameraOff: boolean;
  speaker: boolean;
  elapsed: number;
  start: (kind: CallKind) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  flip: () => Promise<void>;
  setSpeaker: (on: boolean) => void;
  reset: () => void;
};

/**
 * One live call for one conversation.
 *
 * Signaling is relayed by `call_signal()` into the private
 * `call:<conversation>` broadcast topic, so SDP and ICE never travel directly
 * between clients and every frame is checked against conversation membership
 * in the database. Media itself is peer-to-peer DTLS-SRTP and is never
 * recorded, uploaded or stored.
 */
export function useCall(conversationId: string | null, userId: string): CallSession {
  const [phase, setPhase] = useState<Phase>("idle");
  const [call, setCall] = useState<CallRow | null>(null);
  const [outgoing, setOutgoing] = useState(false);
  const [kind, setKind] = useState<CallKind>("audio");
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState<{ status: EndedStatus; mine: boolean } | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const link = useRef<CallLink | null>(null);
  // Candidates can arrive before the callee has answered, i.e. before a
  // CallLink exists. Dropping them makes the caller unreachable on strict
  // networks, so they wait here and are replayed once the link is built.
  const early = useRef<RTCIceCandidateInit[]>([]);
  /** True from the moment we answer a call until its link exists. */
  const answering = useRef(false);
  const callRef = useRef<CallRow | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const localRef = useRef<MediaStream | null>(null);
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null);
  const startedAt = useRef(0);
  const alive = useRef(true);
  const attempt = useRef(0);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (alive.current) setPhase(next);
  }, []);

  const signal = useCallback(async (payload: object) => {
    const current = callRef.current;
    if (!current) return;
    try {
      await rpc<boolean>("call_signal", { p_call: current.id, p_payload: { ...payload, from: userId } });
    } catch { /* the peer retries on its own; a dropped frame is not fatal */ }
  }, [userId]);

  const teardown = useCallback(() => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    link.current?.close();
    link.current = null;
    early.current.length = 0;
    answering.current = false;
    localRef.current?.getTracks().forEach(track => { try { track.stop(); } catch {} });
    localRef.current = null;
    pendingOffer.current = null;
    if (alive.current) {
      setLocal(null); setRemote(null); setStats(null);
      setMuted(false); setCameraOff(false); setSpeaker(false); setElapsed(0);
    }
  }, []);

  const finish = useCallback((status: EndedStatus, mine = false) => {
    attempt.current++;
    teardown();
    callRef.current = null;
    startedAt.current = 0;
    sync("idle");
    if (!alive.current) return;
    setCall(null);
    setEnded({ status, mine });
  }, [sync, teardown]);

  const ensureLink = useCallback(() => {
    if (link.current) return link.current;
    link.current = new CallLink({
      onSignal: frame => { void signal(frame); },
      onState: state => {
        if (state === "connected") {
          if (!startedAt.current) {
            startedAt.current = Date.now();
            link.current?.startStats();
          }
          sync("active");
        }
        if (state === "disconnected" && phaseRef.current === "active") sync("connecting");
        if (state === "failed") {
          const current = callRef.current;
          void signal({ type: "bye", reason: "failed" });
          if (current) void rpc("end_call", { p_call: current.id }).catch(() => {});
          finish("failed");
        }
      },
      onRemote: stream => { if (alive.current) setRemote(new MediaStream(stream.getTracks())); },
      onStats: snapshot => { if (alive.current) setStats(snapshot); },
    }, userId);
    const queued = early.current.splice(0);
    for (const candidate of queued) void link.current.candidate(candidate).catch(() => {});
    return link.current;
  }, [finish, signal, sync, userId]);

  // --- Signaling channel -----------------------------------------------------
  useEffect(() => {
    if (!conversationId) return;
    alive.current = true;
    let disposed = false;
    const client = db();
    let instance: RealtimeChannel | null = null;

    async function handle(frame: Signal, current: CallRow) {
      if (frame.type === "offer") {
        const description: RTCSessionDescriptionInit = { type: "offer", sdp: frame.sdp };
        pendingOffer.current = description;
        if ((phaseRef.current === "connecting" || phaseRef.current === "active") && localRef.current && !answering.current) {
          const peer = ensureLink();
          const response = await peer.answer(description).catch(() => null);
          if (response?.sdp && callRef.current?.id === current.id) await signal({ type: "answer", sdp: response.sdp });
          pendingOffer.current = null;
        }
        return;
      }
      if (frame.type === "answer") {
        if (!link.current) return;
        await link.current.accept({ type: "answer", sdp: frame.sdp }).catch(() => {});
        if (phaseRef.current !== "active") sync("connecting");
        return;
      }
      if (frame.type === "candidate") {
        if (!link.current) {
          if (early.current.length < 200) early.current.push(frame.candidate);
          return;
        }
        await link.current.candidate(frame.candidate).catch(() => {});
        return;
      }
      if (frame.type === "ready") {
        if (current.caller !== userId || !link.current) return;
        // Offers sent while the callee was joining can be missed. Re-send the
        // same offer on ready; CallLink coalesces concurrent offer creation.
        const description = await link.current.offer().catch(() => null);
        if (description?.sdp && callRef.current?.id === current.id) await signal({ type: "offer", sdp: description.sdp, kind: current.kind });
        if (phaseRef.current === "calling") sync("connecting");
        return;
      }
      if (frame.type === "bye") {
        const live = phaseRef.current === "active" || phaseRef.current === "connecting";
        finish(live ? "ended" : "missed");
      }
    }

    const starting = (async () => {
      instance = client.channel("call:" + conversationId, { config: { private: true, broadcast: { self: false } } });
      instance.on("broadcast", { event: "signal" }, ({ payload }) => {
        if (disposed || !alive.current) return;
        const frame = payload as Signal | null;
        const current = callRef.current;
        if (!frame || !current || frame.from === userId) return;
        if (!frame.from || !current) return;
        void handle(frame, current);
      });
      instance.on("broadcast", { event: "call" }, ({ payload }) => {
        if (disposed || !alive.current || !callRef.current || payload?.call_id !== callRef.current.id || payload?.by === userId) return;
        if (payload.status === "declined" || payload.status === "missed" || payload.status === "ended") finish(payload.status);
      });
      await instance.subscribe();
    })().catch(() => {});

    return () => {
      disposed = true;
      void starting.then(() => { if (instance) void client.removeChannel(instance); });
    };
  }, [conversationId, ensureLink, finish, signal, userId]);

  // --- Elapsed clock and caller give-up --------------------------------------
  useEffect(() => {
    if (phase === "idle") return;
    const clock = setInterval(() => {
      if (startedAt.current) setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(clock);
  }, [phase]);

  useEffect(() => {
    if (phase !== "calling") return;
    ringTimer.current = setTimeout(() => { void hangupRef.current(); }, 60000);
    return () => { if (ringTimer.current) clearTimeout(ringTimer.current); ringTimer.current = null; };
  }, [phase]);

  // Until connected the callee can safely request the same offer again.
  useEffect(() => {
    if (phase !== "connecting" || outgoing) return;
    const retry = setInterval(() => { if (phaseRef.current === "connecting") void signal({ type: "ready" }); }, 3000);
    return () => clearInterval(retry);
  }, [phase, outgoing, signal]);

  // --- Call actions ---------------------------------------------------------
  async function start(nextKind: CallKind = "audio") {
    if (!conversationId || phaseRef.current !== "idle") return;
    const version = ++attempt.current;
    setError(""); setEnded(null); setCall(null); setKind(nextKind); setOutgoing(true); sync("calling");
    try {
      const stream = await openMedia();
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "calling") { stream.getTracks().forEach(track => track.stop()); return; }
      localRef.current = stream; setLocal(stream);
      const row = await rpc<CallRow>("start_call", { p_conversation: conversationId, p_kind: "audio" });
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "calling") { stream.getTracks().forEach(track => track.stop()); void rpc("end_call", { p_call: row.id }).catch(() => {}); return; }
      callRef.current = row; setCall(row);
      const peer = ensureLink();
      peer.addLocal(stream);
      const description = await peer.offer();
      if (description.sdp && attempt.current === version && callRef.current?.id === row.id) await signal({ type: "offer", sdp: description.sdp, kind: "audio" });
    } catch (cause) {
      if (!alive.current || attempt.current !== version) return;
      const failed = callRef.current;
      if (failed) void rpc("end_call", { p_call: failed.id }).catch(() => {});
      callRef.current = null; teardown(); sync("idle");
      setError(message(cause));
      setEnded({ status: "failed", mine: true });
    }
  }

  async function accept() {
    const current = callRef.current;
    if (!current || phaseRef.current !== "ringing") return;
    const version = ++attempt.current;
    setError(""); setEnded(null); setOutgoing(false); sync("connecting");
    answering.current = true;
    try {
      const stream = await openMedia();
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "connecting") { stream.getTracks().forEach(track => track.stop()); return; }
      localRef.current = stream; setLocal(stream);
      await rpc("answer_call", { p_call: current.id, p_accept: true });
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "connecting") { stream.getTracks().forEach(track => track.stop()); void rpc("end_call", { p_call: current.id }).catch(() => {}); return; }
      const peer = ensureLink();
      peer.addLocal(stream);
      answering.current = false;
      if (pendingOffer.current) {
        const offer = pendingOffer.current; pendingOffer.current = null;
        const response = await peer.answer(offer);
        if (response.sdp && attempt.current === version && callRef.current?.id === current.id) await signal({ type: "answer", sdp: response.sdp });
      }
      if (attempt.current === version && callRef.current?.id === current.id) await signal({ type: "ready" });
    } catch (cause) {
      if (!alive.current || attempt.current !== version) return;
      teardown(); sync("idle"); setError(message(cause));
      await rpc("end_call", { p_call: current.id }).catch(() => {});
      callRef.current = null; setCall(null); setEnded({ status: "failed", mine: true });
    }
  }

  async function decline() {
    attempt.current++;
    const current = callRef.current;
    teardown();
    callRef.current = null; startedAt.current = 0;
    sync("idle"); setCall(null); setEnded({ status: "declined", mine: true });
    if (current) await rpc("answer_call", { p_call: current.id, p_accept: false }).catch(() => {});
  }

  async function hangup() {
    const current = callRef.current;
    const ringing = phaseRef.current === "calling" || phaseRef.current === "ringing";
    // Stop local audio immediately, even if the network is slow.
    const sent = current ? signal({ type: "bye", reason: "ended" }) : Promise.resolve();
    finish(ringing ? "missed" : "ended", true);
    await sent.catch(() => {});
    if (current) await rpc("end_call", { p_call: current.id }).catch(() => {});
  }
  const hangupRef = useRef(hangup);
  hangupRef.current = hangup;

  function toggleMute() {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  function toggleCamera() {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }

  async function flip() {
    const stream = localRef.current;
    if (!stream || !link.current) return;
    try {
      await link.current.flipCamera(stream);
      if (alive.current) setLocal(new MediaStream(stream.getTracks()));
    } catch { /* a device with a single camera keeps what it has */ }
  }

  function reset() {
    setEnded(null); setError(""); setElapsed(0); setStats(null);
  }

  /**
   * Phones route call audio to the earpiece by default. WebKit exposes
   * `setSinkId` on <audio>; where it is missing the toggle simply hides.
   */
  const applySpeaker = useCallback(async (on: boolean) => {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      const speaker = devices?.find(device => device.kind === "audiooutput" && /speaker|default/i.test(device.label));
      const target = document.querySelector<HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }>(".call-screen audio");
      if (!target?.setSinkId) return;
      await target.setSinkId(on && speaker?.deviceId ? speaker.deviceId : "");
    } catch { /* unsupported sink selection keeps the OS default */ }
  }, []);
  useEffect(() => { void applySpeaker(speaker).catch(() => {}); }, [speaker, applySpeaker, remote]);

  // --- Incoming rings -------------------------------------------------------
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const client = db();
    const instance = client.channel("incoming:" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: "callee=eq." + userId }, event => {
        const row = event.new as CallRow;
        if (cancelled || row.status !== "ringing" || row.conversation_id !== conversationId) return;
        if (phaseRef.current !== "idle" || callRef.current) return;
        callRef.current = row;
        setCall(row); setKind(row.kind); setOutgoing(false); setEnded(null); setError("");
        sync("ringing");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: "callee=eq." + userId }, event => {
        const row = event.new as CallRow;
        if (!callRef.current || row.id !== callRef.current.id) return;
        callRef.current = { ...callRef.current, ...row };
        if (row.status === "declined" || row.status === "ended" || row.status === "missed") {
          if (phaseRef.current === "ringing" || phaseRef.current === "calling") finish(row.status);
          else if (row.status === "ended" && phaseRef.current !== "idle") finish("ended");
        }
      })
      .subscribe();
    return () => { cancelled = true; void client.removeChannel(instance); };
  }, [conversationId, finish, sync, userId]);

  // Rings that arrived while this tab was asleep.
  useEffect(() => {
    if (!conversationId) return;
    const poll = async () => {
      try {
        if (document.visibilityState !== "visible" || phaseRef.current !== "idle" || callRef.current) return;
        const { data } = await db().from("calls").select("*").eq("conversation_id", conversationId).eq("callee", userId).eq("status", "ringing").order("started_at", { ascending: false }).limit(1);
        const row = data?.[0] as CallRow | undefined;
        if (!row) return;
        if (row.caller === userId || Date.now() - new Date(row.started_at).getTime() > 55000) {
          await rpc("answer_call", { p_call: row.id, p_accept: false }).catch(() => {});
          return;
        }
        callRef.current = row;
        setCall(row); setKind(row.kind); setOutgoing(false); setEnded(null);
        sync("ringing");
      } catch { /* offline */ }
    };
    const timer = setInterval(() => void poll(), 12000);
    void poll();
    return () => clearInterval(timer);
  }, [conversationId, sync, userId]);

  useEffect(() => () => {
    const current = callRef.current;
    if (current) {
      void signal({ type: "bye", reason: "ended" });
      void rpc("end_call", { p_call: current.id }).catch(() => {});
      callRef.current = null;
    }
    attempt.current++; alive.current = false; teardown();
  }, [teardown, signal]);

  return {
    phase, call, outgoing, kind, local, remote, stats, error, ended,
    muted, cameraOff, speaker, elapsed: startedAt.current ? elapsed : 0,
    start, accept, decline, hangup, toggleMute, toggleCamera, flip, setSpeaker, reset,
  };
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not start the call.";
}
