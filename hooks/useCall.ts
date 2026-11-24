import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db, rpc } from "@/lib/supabase";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";
import { errorText } from "@/lib/types";
import { CallLink, callIceServers, iceServers, openMedia, type CallKind, type CallRow, type CallStats, type Signal } from "@/lib/rtc";

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
  elapsed: number;
  fetchingRelay: boolean;
  retryConnection: () => void;
  endPreviousCall: () => Promise<boolean>;
  start: (kind: CallKind) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
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
  const [elapsed, setElapsed] = useState(0);
  const [fetchingRelay, setFetchingRelay] = useState(false);

  const link = useRef<CallLink | null>(null);
  const servers = useRef<RTCIceServer[] | null>(null);
  // Candidates can arrive before the callee has answered, i.e. before a
  // CallLink exists. Dropping them makes the caller unreachable on strict
  // networks, so they wait here and are replayed once the link is built.
  const early = useRef<RTCIceCandidateInit[]>([]);
  const sentCandidates = useRef<Signal[]>([]);
  /** True from the moment we answer a call until its link exists. */
  const answering = useRef(false);
  const callRef = useRef<CallRow | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const localRef = useRef<MediaStream | null>(null);
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null);
  const negotiations = useRef<Promise<void>>(Promise.resolve());
  const startedAt = useRef(0);
  const alive = useRef(true);
  const attempt = useRef(0);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRestart = useRef(0);
  const restartRef = useRef<(force?: boolean) => void>(() => {});
  const accessToken = useRef("");
  const channelGate = useRef<{ conversation: string; ready: boolean; waiters: Set<(ready: boolean) => void> } | null>(null);

  const sync = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (alive.current) setPhase(next);
  }, []);

  const waitForSignaling = useCallback(async () => {
    const gate = channelGate.current;
    if (!gate || gate.conversation !== conversationId) throw new Error("Call signaling is not ready. Please try again.");
    if (gate.ready) return;
    const ready = await new Promise<boolean>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const done = (value: boolean) => { clearTimeout(timer); gate.waiters.delete(done); resolve(value); };
      gate.waiters.add(done);
      timer = setTimeout(() => done(false), 12000);
    });
    if (!ready || channelGate.current !== gate) throw new Error("Call signaling unavailable. Check your connection and try again.");
  }, [conversationId]);

  const signal = useCallback(async (payload: object) => {
    const current = callRef.current;
    if (!current) return;
    try {
      await waitForSignaling();
      if (callRef.current?.id !== current.id) return;
      const sent = await rpc<boolean>("call_signal", { p_call: current.id, p_payload: { ...payload, from: userId } });
      if (sent === false) throw new Error("Call has ended.");
    } catch {
      if (alive.current && callRef.current?.id === current.id) setError("Call signaling interrupted. Check your connection.");
    }
  }, [userId, waitForSignaling]);

  const teardown = useCallback(() => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = null; lastRestart.current = 0;
    link.current?.close();
    link.current = null;
    servers.current = null;
    early.current.length = 0;
    sentCandidates.current.length = 0;
    answering.current = false;
    localRef.current?.getTracks().forEach(track => { try { track.stop(); } catch {} });
    localRef.current = null;
    pendingOffer.current = null;
    negotiations.current = Promise.resolve();
    if (alive.current) {
      setLocal(null); setRemote(null); setStats(null);
      setMuted(false); setElapsed(0); setFetchingRelay(false);
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
    if (!servers.current) throw new Error("Call relay is not ready.");
    link.current = new CallLink({
      onSignal: frame => { if (frame.type === "candidate" && sentCandidates.current.length < 200) sentCandidates.current.push(frame); void signal(frame); },
      onState: state => {
        if (state === "connected") {
          if (restartTimer.current) clearTimeout(restartTimer.current);
          restartTimer.current = null;
          if (!startedAt.current) {
            startedAt.current = Date.now();
            link.current?.startStats();
          }
          sync("active");
        }
        if (state === "disconnected" || state === "failed") {
          if (phaseRef.current === "active") sync("connecting");
          if (!restartTimer.current) restartTimer.current = setTimeout(() => { restartTimer.current = null; restartRef.current(); }, state === "failed" ? 0 : 3000);
        }
      },
      onRemote: stream => { if (alive.current) setRemote(new MediaStream(stream.getTracks())); },
      onStats: snapshot => { if (alive.current) setStats(snapshot); },
    }, userId, servers.current);
    const queued = early.current.splice(0);
    for (const candidate of queued) void link.current.candidate(candidate).catch(() => {});
    return link.current;
  }, [finish, signal, sync, userId]);

  restartRef.current = (force = false) => {
    const current = callRef.current, peer = link.current;
    if (!current || !peer || !["active", "connecting"].includes(phaseRef.current) || !force && Date.now() - lastRestart.current < 5000) return;
    lastRestart.current = Date.now();
    if (force) { sync("connecting"); setError(""); }
    if (current.caller !== userId) { void signal({ type: "restart" }); return; }
    if (peer.signalingStable()) peer.requestIceRestart();
    if (peer.signalingStable()) sentCandidates.current.length = 0;
    void peer.restartOffer().then(async description => {
      if (description?.sdp && callRef.current?.id === current.id) {
        await signal({ type: "offer", sdp: description.sdp, kind: "audio" });
        for (const candidate of sentCandidates.current) { if (callRef.current?.id !== current.id) break; void signal(candidate); }
      }
    }).catch(() => {});
  };

  useEffect(() => {
    const changed = () => { if (phaseRef.current === "active" || phaseRef.current === "connecting") restartRef.current(); };
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    window.addEventListener("online", changed); connection?.addEventListener("change", changed);
    return () => { window.removeEventListener("online", changed); connection?.removeEventListener("change", changed); };
  }, []);

  // --- Signaling channel -----------------------------------------------------
  useEffect(() => {
    if (!conversationId) return;
    alive.current = true;
    let disposed = false;
    const client = db();
    let instance: RealtimeChannel | null = null;
    const gate = { conversation: conversationId, ready: false, waiters: new Set<(ready: boolean) => void>() };
    channelGate.current = gate;

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
        if (callRef.current?.id === current.id && phaseRef.current !== "active") sync(link.current.connectionState() === "connected" ? "active" : "connecting");
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
        if (current.caller !== userId || !link.current || startedAt.current) return;
        // Offers sent while the callee was joining can be missed. Re-send the
        // same offer on ready; CallLink coalesces concurrent offer creation.
        const description = await link.current.offer().catch(() => null);
        if (description?.sdp && callRef.current?.id === current.id) {
          await signal({ type: "offer", sdp: description.sdp, kind: current.kind });
          for (const candidate of sentCandidates.current) { if (callRef.current?.id !== current.id) break; void signal(candidate); }
        }
        if (callRef.current?.id === current.id && phaseRef.current === "calling") sync("connecting");
        return;
      }
      if (frame.type === "restart") {
        if (current.caller === userId) restartRef.current();
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
        if (!frame || !current || frame.from === userId || frame.from !== (current.caller === userId ? current.callee : current.caller)) return;
        if ((frame as Signal & { callId?: string }).callId !== current.id) return;
        const run = async () => {
          if (disposed || callRef.current?.id !== current.id) return;
          try { await handle(frame, current); }
          catch { if (!disposed && callRef.current?.id === current.id) setError("Call negotiation failed. Try reconnecting."); }
        };
        // SDP changes must not race a second offer (e.g. an ICE restart).
        // Candidates are handled immediately and buffered by CallLink.
        if (frame.type === "offer" || frame.type === "answer") negotiations.current = negotiations.current.then(run, run);
        else void run();
      });
      instance.on("broadcast", { event: "call" }, ({ payload }) => {
        if (disposed || !alive.current || !callRef.current || payload?.call_id !== callRef.current.id || payload?.by === userId) return;
        if (payload.status === "declined" || payload.status === "missed" || payload.status === "ended") finish(payload.status);
      });
      instance.subscribe(status => {
        if (disposed) return;
        gate.ready = status === "SUBSCRIBED";
        if (gate.ready || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          for (const done of [...gate.waiters]) done(gate.ready);
        }
      });
    })().catch(() => {});

    return () => {
      disposed = true;
      if (channelGate.current === gate) channelGate.current = null;
      for (const done of [...gate.waiters]) done(false);
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
    if (phase !== "connecting" || outgoing || startedAt.current) return;
    const retry = setInterval(() => { if (phaseRef.current === "connecting") void signal({ type: "ready" }); }, 3000);
    return () => clearInterval(retry);
  }, [phase, outgoing, signal]);

  // Lost restart signals are retried while reconnecting, but never generate
  // simultaneous offers: the caller is the only offerer.
  useEffect(() => {
    if (phase !== "connecting") return;
    const timer = setInterval(() => restartRef.current(), 8000);
    return () => clearInterval(timer);
  }, [phase]);

  // Avoid leaving both people indefinitely on a connecting screen.
  useEffect(() => {
    if (phase !== "connecting") return;
    const timer = setTimeout(() => {
      if (phaseRef.current !== "connecting") return;
      const current = callRef.current;
      void signal({ type: "bye", reason: "failed" });
      if (current) void rpc("end_call", { p_call: current.id }).catch(() => {});
      setError("Couldn’t connect. Check your network or call relay.");
      finish("failed");
    }, 60000);
    return () => clearTimeout(timer);
  }, [phase, finish, signal]);

  // --- Call actions ---------------------------------------------------------
  async function start(nextKind: CallKind = "audio") {
    if (!conversationId || phaseRef.current !== "idle") return;
    const version = ++attempt.current;
    setError(""); setEnded(null); setCall(null); setKind(nextKind); setOutgoing(true); sync("calling");
    try {
      const stream = await openMedia();
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "calling") { stream.getTracks().forEach(track => track.stop()); return; }
      localRef.current = stream; setLocal(stream);
      await waitForSignaling();
      if (!alive.current || attempt.current !== version) return;
      const row = await rpc<CallRow>("start_call", { p_conversation: conversationId, p_kind: "audio" });
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "calling") { stream.getTracks().forEach(track => track.stop()); void rpc("end_call", { p_call: row.id }).catch(() => {}); return; }
      callRef.current = row; setCall(row);
      setFetchingRelay(true);
      const ice = await callIceServers(row.id).catch((cause: unknown) => { if (alive.current && attempt.current === version) setError("Call relay unavailable. Trying a direct connection; some networks may block it." + (cause instanceof Error && /Cloudflare|request limit/.test(cause.message) ? " " + cause.message : "")); return iceServers(); });
      if (!alive.current || attempt.current !== version || callRef.current?.id !== row.id) return;
      setFetchingRelay(false);
      servers.current = ice;
      const peer = ensureLink();
      peer.addLocal(stream);
      const description = await peer.offer();
      if (description.sdp && attempt.current === version && callRef.current?.id === row.id) await signal({ type: "offer", sdp: description.sdp, kind: "audio" });
    } catch (cause) {
      if (!alive.current || attempt.current !== version) return;
      const failed = callRef.current;
      if (failed) void rpc("end_call", { p_call: failed.id }).catch(() => {});
      callRef.current = null; teardown(); sync("idle"); setCall(null);
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
      await waitForSignaling();
      if (!alive.current || attempt.current !== version) return;
      await rpc("answer_call", { p_call: current.id, p_accept: true });
      if (!alive.current || attempt.current !== version || (phaseRef.current as Phase) !== "connecting") { stream.getTracks().forEach(track => track.stop()); void rpc("end_call", { p_call: current.id }).catch(() => {}); return; }
      setFetchingRelay(true);
      const ice = await callIceServers(current.id).catch((cause: unknown) => { if (alive.current && attempt.current === version) setError("Call relay unavailable. Trying a direct connection; some networks may block it." + (cause instanceof Error && /Cloudflare|request limit/.test(cause.message) ? " " + cause.message : "")); return iceServers(); });
      if (!alive.current || attempt.current !== version || callRef.current?.id !== current.id) return;
      setFetchingRelay(false);
      servers.current = ice;
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
    // Start the authoritative end request immediately. A signaling channel
    // may be reconnecting for several seconds and must not delay hangup.
    const ending = current ? rpc("end_call", { p_call: current.id }).catch(() => {}) : Promise.resolve();
    if (current) void signal({ type: "bye", reason: "ended" });
    finish(ringing ? "missed" : "ended", true);
    await ending;
  }
  const hangupRef = useRef(hangup);
  hangupRef.current = hangup;

  function toggleMute() {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  async function endPreviousCall() {
    if (!conversationId) return false;
    try { await rpc("end_open_call", { p_conversation: conversationId }); setError(""); return true; }
    catch (cause) { setError(errorText(cause)); return false; }
  }

  function reset() {
    setEnded(null); setError(""); setElapsed(0); setStats(null);
  }

  // --- Incoming rings -------------------------------------------------------
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const client = db();
    const instance = client.channel("incoming:" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: "callee=eq." + userId }, event => {
        const row = event.new as CallRow;
        if (cancelled || row.status !== "ringing" || row.conversation_id !== conversationId || !Number.isFinite(Date.parse(row.started_at)) || Date.now() - Date.parse(row.started_at) > 55000) return;
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
    let cancelled = false;
    const poll = async () => {
      try {
        if (document.visibilityState !== "visible" || phaseRef.current !== "idle" || callRef.current) return;
        const { data } = await db().from("calls").select("*").eq("conversation_id", conversationId).eq("callee", userId).eq("status", "ringing").order("started_at", { ascending: false }).limit(1);
        const row = data?.[0] as CallRow | undefined;
        if (!row || cancelled || phaseRef.current !== "idle" || callRef.current) return;
        if (row.caller === userId || !Number.isFinite(Date.parse(row.started_at)) || Date.now() - new Date(row.started_at).getTime() > 55000) {
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
    return () => { cancelled = true; clearInterval(timer); };
  }, [conversationId, sync, userId]);

  useEffect(() => {
    let mounted = true;
    const auth = db().auth;
    void auth.getSession().then(({ data }) => { if (mounted) accessToken.current = data.session?.access_token ?? ""; });
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => { accessToken.current = session?.access_token ?? ""; });
    return () => { mounted = false; subscription.unsubscribe(); accessToken.current = ""; };
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      const current = callRef.current, token = accessToken.current;
      if (current && token) {
        void fetch(SUPABASE_URL + "/rest/v1/rpc/end_call", { method:"POST", keepalive:true, headers:{"Content-Type":"application/json", apikey:SUPABASE_KEY, Authorization:"Bearer " + token}, body:JSON.stringify({p_call:current.id}) }).catch(() => {});
      }
      if (current) finish(phaseRef.current === "ringing" || phaseRef.current === "calling" ? "missed" : "ended", true);
      else { attempt.current++; teardown(); }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [finish, teardown]);

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
    muted, elapsed: startedAt.current ? elapsed : 0,
    fetchingRelay, retryConnection: () => restartRef.current(true), endPreviousCall,
    start, accept, decline, hangup, toggleMute, reset,
  };
}

function message(cause: unknown) {
  return cause == null ? "Could not start the call." : errorText(cause);
}
