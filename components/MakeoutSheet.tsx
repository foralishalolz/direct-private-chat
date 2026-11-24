"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Sparkles } from "lucide-react";
import { db, rpc } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { useLive } from "@/hooks/useLive";
import { kissLevel, heartBurst, streakWord, kissBatch, type KissMeter } from "@/lib/kiss";
import { errorText, label, type Conversation, type Profile } from "@/lib/types";
import { Avatar, ErrorNote, Modal } from "./UI";

type Pop = { id: number; left: number; drift: number; rise: number; spin: number; delay: number; glyph: string };

const GLYPHS = ["💋", "💕", "💞", "🫦", "😽", "❤️", "💘", "🌸"];

/**
 * Digital makeout. Taps are optimistic locally and batched into `kiss()` calls
 * so a fast burst still costs one round trip per ~400ms.
 */
export default function MakeoutSheet({ c, p, onClose }: { c: Conversation; p: Profile; onClose: () => void }) {
  const live = useLive<{ meter: KissMeter | null }>(
    "kiss:" + c.id,
    ["kiss_meter"],
    async () => {
      const result = await db().from("kiss_meter").select("taps_a,taps_b,last_at").eq("conversation_id", c.id).maybeSingle();
      if (result.error) throw result.error;
      return { meter: (result.data as KissMeter | null) ?? null };
    },
    { meter: null },
  );
  const [pending, setPending] = useState(0);

  const [streak, setStreak] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const alive = useRef(true), queue = useRef(0), inFlight = useRef(false), flushRef = useRef<() => void>(() => {}), timer = useRef<ReturnType<typeof setTimeout> | null>(null), popId = useRef(0), streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partner = c.partner;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (streakTimer.current) clearTimeout(streakTimer.current);
      // Flush unsent taps, including bursts larger than the RPC batch limit.
      void flushRef.current();
    };
  }, [c.id]);

  const flush = useCallback(async () => {
    if (inFlight.current || !queue.current) return;
    const count = kissBatch(queue.current);
    queue.current -= count;
    inFlight.current = true;
    if (alive.current) setSending(true);
    let success = false;
    try {
      const result = await rpc<{ taps_a: number; taps_b: number; last_at: string }>("kiss", { p_conversation: c.id, p_count: count });
      success = true;
      if (alive.current) {
        setPending(value => Math.max(0, value - count));
        live.setData({ meter: { taps_a: result.taps_a, taps_b: result.taps_b, last_at: result.last_at } });
        setError("");
      }
    } catch (cause) {
      queue.current += count;
      if (alive.current) setError(errorText(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setSending(false);
      if (success && queue.current) void flushRef.current();
    }
  }, [c.id, live]);
  flushRef.current = () => { void flush(); };

  function tap() {
    queue.current += 1;
    setPending(value => value + 1);
    setStreak(value => {
      const next = value + 1;
      if (streakTimer.current) clearTimeout(streakTimer.current);
      streakTimer.current = setTimeout(() => { if (alive.current) setStreak(0); }, 1800);
      return next;
    });
    if (popId.current % 3 === 0) haptic("light");
    const id = ++popId.current;
    const index = popId.current;
    setPops(list => [...list.slice(-14), { id, ...heartBurst(index), glyph: GLYPHS[index % GLYPHS.length] }]);
    setTimeout(() => { if (alive.current) setPops(list => list.filter(pop => pop.id !== id)); }, 1400);
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flush(); }, 420);
  }

  const meter = live.data.meter;
  const isA = c.member_a === p.id;
  const mine = (isA ? meter?.taps_a : meter?.taps_b) ?? 0;
  const theirs = (isA ? meter?.taps_b : meter?.taps_a) ?? 0;
  const total = mine + theirs + pending;
  const partnerTotal = theirs;
  const level = kissLevel(total);
  const streakText = streak > 2 ? streakWord(streak) : "";

  return (
    <Modal title="Makeout" onClose={onClose}>
      <div className="makeout">
        <div className="makeout-pair" aria-hidden="true">
          <Avatar profile={p} size={58} />
          <span className={"makeout-heart" + (streak > 2 ? " beating" : "")}><Heart size={26} /></span>
          <Avatar profile={partner} size={58} />
        </div>
        <div className="makeout-level">
          <span aria-hidden="true">{level.glyph}</span>
          <strong>{level.label}</strong>
          <small>{total.toLocaleString()} kisses</small>
        </div>
        <div className="makeout-bar" role="img" aria-label={level.next ? `${Math.round(level.progress * 100)}% to ${level.next.label}` : "Highest level"}>
          <span style={{ width: Math.round(level.progress * 100) + "%" }} />
        </div>
        {level.next && <small className="makeout-hint">{(level.next.at - total).toLocaleString()} more to {level.next.label} {level.next.glyph}</small>}

        <button type="button" className="makeout-stage" aria-label="Kiss" onClick={tap}>
          <span className="makeout-lips" aria-hidden="true">💋</span>
          <span className="makeout-taps">
            <b>{mine.toLocaleString()}</b> you · <b>{partnerTotal.toLocaleString()}</b> {label(partner)}
          </span>
          <span className="makeout-live" role="status">
            {theirs > mine ? label(partner) + " is winning" : mine > theirs ? "You are winning" : "Neck and neck"}
          </span>
          {streakText && <span className="makeout-streak" role="status" key={streak}>{streakText}</span>}
          <span className="makeout-pops" aria-hidden="true">
            {pops.map(pop => (
              <i key={pop.id} style={{
                left: pop.left + "%",
                ["--drift" as string]: pop.drift + "px",
                ["--rise" as string]: "-" + pop.rise + "px",
                ["--spin" as string]: pop.spin + "deg",
                animationDelay: pop.delay + "ms",
              }}>{pop.glyph}</i>
            ))}
          </span>
        </button>

        <div className="makeout-foot">
          <small>{sending ? "Sending…" : "Tap as fast as you like"}</small>
          <Sparkles size={15} />
        </div>

        <ErrorNote text={error || live.error} />
      {error && <button className="quiet-button" onClick={() => void flush()}>Retry kisses</button>}
      </div>
    </Modal>
  );
}
