"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLive } from "@/hooks/useLive";
import { haptic } from "@/lib/haptics";
import { db, rpc } from "@/lib/supabase";
import { errorText, label, type Conversation, type Profile } from "@/lib/types";
import {
  COUPLE_3D_MODES,
  WORLD,
  broadcastPayload,
  clampPosition,
  eligibleHearts,
  modeInfo,
  resultText,
  scoreLine,
  sideForUser,
  validateBroadcast,
  type AvatarPosition,
  type Couple3DBroadcast,
  type Couple3DHeart,
  type Couple3DMatch,
  type Couple3DMode,
} from "@/lib/couple3d";
import { ErrorNote, Spinner } from "./UI";

const Couple3DScene = dynamic(() => import("./Couple3DScene"), {
  ssr: false,
  loading: () => <div className="center pad"><Spinner /></div>,
});

type Channel = ReturnType<ReturnType<typeof db>["channel"]>;
type View = "loading" | "3d" | "list";

export default function Couple3DArcade({ c, p }: { c: Conversation; p: Profile }) {
  const live = useLive<Couple3DMatch | null>(
    "couple3d-match:" + c.id,
    ["couple_3d_match"],
    async () => {
      const response = await db().from("couple_3d_match").select("*").eq("conversation_id", c.id).maybeSingle();
      if (response.error) throw response.error;
      return response.data as Couple3DMatch | null;
    },
    null,
  );
  const match = live.data;
  const active = !!match && !match.finished;
  const side = sideForUser(c.member_a, c.member_b, p.id);
  const partnerName = label(c.partner) || "Your person";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("loading");
  const [webglSupported, setWebglSupported] = useState(false);
  const [webglNote, setWebglNote] = useState("");
  const [reduced, setReduced] = useState(false);
  const [connected, setConnected] = useState(false);
  const [peerSeen, setPeerSeen] = useState(0);
  const [now, setNow] = useState(Date.now());
  const busyRef = useRef(false);
  const matchRef = useRef<Couple3DMatch | null>(match);
  const myPos = useRef<AvatarPosition>({ x: c.member_a === p.id ? -3 : 3, y: 1.3, z: 6, yaw: 0, t: Date.now() });
  const peerRef = useRef<AvatarPosition | null>(null);
  const channelRef = useRef<Channel | null>(null);
  matchRef.current = match;

  const send = useCallback((payload: Couple3DBroadcast) => {
    const channel = channelRef.current;
    if (!channel) return;
    void Promise.resolve(channel.send({ type: "broadcast", event: "couple3d", payload })).catch(() => undefined);
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await live.refresh();
      haptic("light");
    } catch (e) {
      setError(errorText(e));
      await live.refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [live.refresh]);

  const start = useCallback((mode: Couple3DMode) => {
    void act(async () => {
      const result = await rpc<Couple3DMatch>("start_couple_3d", { p_conversation: c.id, p_mode: mode });
      live.setData(result);
      peerRef.current = null;
      setPeerSeen(0);
    });
  }, [act, c.id, live.setData]);

  const end = useCallback(() => {
    const round = matchRef.current;
    if (!round || !window.confirm("End this 3D round for both players?")) return;
    void act(async () => {
      const result = await rpc<Couple3DMatch>("submit_couple_3d", {
        p_conversation: c.id,
        p_round: round.round_id,
        p_action: "end",
        p_payload: {},
      });
      live.setData(result);
    });
  }, [act, c.id, live.setData]);

  const submitCollect = useCallback((itemId: string) => {
    const round = matchRef.current;
    if (!round || round.finished || busyRef.current) return;
    const heart = round.items.find(item => item.id === itemId);
    if (!heart || heart.collected_by) return;
    void act(async () => {
      const result = await rpc<Couple3DMatch>("submit_couple_3d", {
        p_conversation: c.id,
        p_round: round.round_id,
        p_action: "collect",
        p_payload: { item: itemId },
      });
      live.setData(result);
      send(broadcastPayload("collect", p.id, round.round_id, undefined, itemId));
    });
  }, [act, c.id, live.setData, p.id, send]);

  const handleMove = useCallback((position: AvatarPosition) => {
    const roundId = matchRef.current?.round_id;
    if (!roundId) return;
    const clean = clampPosition({ ...position, t: Date.now() });
    myPos.current = clean;
    send(broadcastPayload("move", p.id, roundId, clean));
  }, [p.id, send]);

  const handleSceneError = useCallback((message: string) => {
    setWebglSupported(false);
    setWebglNote(message);
    setView("list");
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    let supported = false;
    try {
      const canvas = document.createElement("canvas");
      supported = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      supported = false;
    }
    setWebglSupported(supported);
    setView(supported ? "3d" : "list");
    if (!supported) setWebglNote("3D is unavailable here. Use the heart list to keep playing together.");
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void live.refresh();
    }, 3000);
    return () => clearInterval(poll);
  }, [live.refresh]);

  const roundId = match?.round_id;
  const finished = match?.finished;
  useEffect(() => {
    if (!roundId || finished || !side) return;
    const client = db();
    const channel = client.channel("couple3d:" + c.id, { config: { broadcast: { self: false, ack: false } } });
    channelRef.current = channel;
    channel.on("broadcast", { event: "couple3d" }, ({ payload }: { payload: unknown }) => {
      const parsed = validateBroadcast(payload, roundId);
      if (!parsed || parsed.userId === p.id) return;
      if (parsed.type === "collect") {
        void live.refresh();
        return;
      }
      peerRef.current = { x: parsed.x ?? 0, y: parsed.y ?? 1.3, z: parsed.z ?? 0, yaw: parsed.yaw ?? 0, t: parsed.t ?? Date.now() };
      setPeerSeen(Date.now());
    });
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") {
        setConnected(true);
        send(broadcastPayload("sync", p.id, roundId, myPos.current));
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnected(false);
      }
    });
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") send(broadcastPayload("sync", p.id, roundId, myPos.current));
    }, 2000);
    return () => {
      clearInterval(heartbeat);
      setConnected(false);
      if (channelRef.current === channel) channelRef.current = null;
      void client.removeChannel(channel);
    };
  }, [c.id, finished, live.refresh, p.id, roundId, send, side]);

  if (c.kind !== "direct" || !side) {
    return <section className="couple3d" aria-label="3D couple games"><div className="center pad"><p>3D games are just for the two of you in a private chat.</p></div></section>;
  }
  if (live.loading) return <section className="couple3d" aria-label="3D couple games"><div className="center pad"><Spinner /></div></section>;

  const picker = <div className="couple3d-picker" aria-label="Choose a 3D game">
    {COUPLE_3D_MODES.map(item => <button className="couple3d-card" key={item.id} disabled={busy} onClick={() => start(item.id)}>
      <span className="couple3d-card-icon" aria-hidden="true">{item.icon}</span>
      <strong>{item.name}</strong>
      <small>{item.hint}</small>
      <p>{item.blurb}</p>
      <span className="couple3d-rule">{item.rule}</span>
    </button>)}
  </div>;

  const credits = <p className="couple3d-credits">Procedural, no-download worlds adapted from MIT-licensed open-source 3D multiplayer ideas on {" "}
    <a href="https://github.com/webgl-games/arcade-3d" target="_blank" rel="noreferrer">Arcade 3D</a>, {" "}
    <a href="https://github.com/assishmoncs/polyworld-arena" target="_blank" rel="noreferrer">PolyWorld Arena</a>, {" "}
    <a href="https://github.com/DevanMetz/openrp" target="_blank" rel="noreferrer">OpenRP</a> and {" "}
    <a href="https://github.com/dmitrymorozoff/xtanks" target="_blank" rel="noreferrer">xTanks</a>. No external scripts or game assets are loaded.
  </p>;

  if (!active || !match) {
    return <section className="couple3d" aria-label="3D couple games">
      {match?.finished && <div className="couple3d-result"><span aria-hidden="true">{match.mode === "garden" ? "🌷" : "✨"}</span><strong>{resultText(match, p.id, partnerName)}</strong><button className="primary" disabled={busy} onClick={() => start(match.mode)}>Play again</button></div>}
      <div className="couple3d-intro"><small>3D TOGETHER</small><h3>Little worlds for just us two</h3><p>Move in real time, collect promise hearts and let your partner see where you are. Choose a world to pull them into the same round.</p></div>
      {picker}
      {credits}
      <ErrorNote text={error || live.error} />
    </section>;
  }

  const info = modeInfo(match.mode);
  const hearts: readonly Couple3DHeart[] = match.items ?? [];
  const eligible = new Set(eligibleHearts(match.mode, hearts).map(heart => heart.id));
  const remaining = hearts.filter(heart => !heart.collected_by).length;
  const peerLive = peerSeen > 0 && now - peerSeen < WORLD.peerStaleMs;
  const connection = connected ? (peerLive ? "Partner nearby · positions live" : "Waiting for your person to join") : "Connecting live positions…";
  const instruction = match.mode === "garden"
    ? "Stand beside the same bloom together to open it."
    : match.mode === "rally"
      ? "Only the next glowing constellation star is live. First to four wins."
      : "Glide under a floating heart to collect it. Most hearts wins.";

  return <section className="couple3d" aria-label="3D couple games">
    <div className="couple3d-head">
      <div><small>3D LIVE GAME</small><h3><span aria-hidden="true">{info.icon}</span> {info.name}</h3></div>
      <button disabled={busy} onClick={end}>End</button>
    </div>
    <div className="couple3d-scorebar">
      <strong>{scoreLine(match, side, partnerName)}</strong>
      <span>{remaining} heart{remaining === 1 ? "" : "s"} left</span>
      <span className={connected ? "live-dot on" : "live-dot"} aria-hidden="true" />
    </div>
    <div className="couple3d-switch" role="group" aria-label="Game view">
      <button aria-pressed={view === "3d"} disabled={!webglSupported} onClick={() => setView("3d")}>3D world</button>
      <button aria-pressed={view === "list"} onClick={() => setView("list")}>Heart list</button>
    </div>
    {view === "loading" && <div className="center pad"><Spinner /></div>}
    {view === "3d" && <Couple3DScene
      mode={match.mode}
      hearts={hearts}
      side={side}
      peerRef={peerRef}
      onMove={handleMove}
      onCollect={submitCollect}
      onError={handleSceneError}
      reducedMotion={reduced}
    />}
    {view === "list" && <div className="couple3d-hearts" aria-label="Heart list">
      {hearts.map((heart, index) => <button
        key={heart.id}
        aria-label={`Collect heart ${index + 1}`}
        disabled={busy || !!heart.collected_by || (match.mode === "rally" && !eligible.has(heart.id))}
        className={eligible.has(heart.id) ? "available" : ""}
        onClick={() => submitCollect(heart.id)}
      >
        <span aria-hidden="true">{heart.collected_by === "a" ? "💗" : heart.collected_by === "b" ? "🩵" : "💖"}</span>
        <small>{heart.collected_by ? "Collected" : match.mode === "rally" && !eligible.has(heart.id) ? "Wait" : `Heart ${index + 1}`}</small>
      </button>)}
    </div>}
    <div className="couple3d-status" role="status"><strong>{connection}</strong><span>{instruction}</span></div>
    <ErrorNote text={error || live.error || webglNote} />
  </section>;
}
