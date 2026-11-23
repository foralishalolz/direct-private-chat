"use client";

import { useEffect, useRef, useState } from "react";
import { db, rpc } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { label, title, type Conversation, type Profile } from "@/lib/types";

export type ActivityKind = "makeout" | "game" | "draw" | "wyr" | "kiss" | "pet" | "arcade" | "listen";

const NAMES: Record<ActivityKind, { verb: string; icon: string }> = {
  makeout: { verb: "wants to make out", icon: "💋" },
  game: { verb: "started a game", icon: "🎮" },
  draw: { verb: "opened a drawing for you two", icon: "🎨" },
  wyr: { verb: "has a would-you-rather", icon: "🤔" },
  listen: { verb: "started listening together", icon: "🎵" },
  arcade: { verb: "started a live game", icon: "🎮" },
  pet: { verb: "opened your pet", icon: "🐾" },
  kiss: { verb: "sent you a kiss", icon: "💞" },
};

export type ActivityPing = { kind: ActivityKind; conversationId: string; from: string; name: string; at: number };

/**
 * Watches `shared_activity` for every conversation I belong to. When the other
 * person opens a game, the makeout meter or a shared canvas, open the same
 * panel on this side.
 *
 * Realtime is the fast path; a slow poll covers a dropped socket, and the
 * banner is deduplicated so the two paths never double-fire.
 */
export function useActivityPing(profile: Profile, conversations: Conversation[], onOpen: (conversationId: string, kind: ActivityKind) => void) {
  const [ping, setPing] = useState<ActivityPing | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const seen = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = conversations.map(c => c.id).sort().join(",");

  useEffect(() => {
    if (!ids) return;
    const client = db();
    let alive = true;
    const channel = client.channel("activity:" + profile.id);
    const handle = (row: { conversation_id?: string; kind?: ActivityKind; opened_by?: string; opened_at?: string; closed_at?: string | null } | null) => {
      if (!alive) return;
      if (!row?.opened_at || Date.now() - Date.parse(row.opened_at) > 60000) return;
      if (!row || !row.conversation_id || row.closed_at || row.opened_by === profile.id) return;
      const conversation = conversations.find(c => c.id === row.conversation_id);
      if (!conversation) return;
      const key = row.conversation_id + ":" + row.kind + ":" + (row.opened_at ?? "");
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (seen.current.size > 60) seen.current = new Set([...seen.current].slice(-40));
      haptic("success");
      const name = label(conversation.partner) || title(conversation) || "Your person";
      if (!row.kind || !(row.kind in NAMES)) return;
      setPing({ kind: row.kind, conversationId: row.conversation_id, from: row.opened_by ?? "", name, at: Date.now() });
      openRef.current(row.conversation_id, row.kind);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (alive) setPing(null); }, 12000);
    };
    channel.on("postgres_changes", { event: "*", schema: "public", table: "shared_activity" }, payload => handle(payload.new as Parameters<typeof handle>[0]));
    const poll = async () => {
      const { data } = await client.from("shared_activity").select("conversation_id,kind,opened_by,opened_at,closed_at").in("conversation_id", ids.split(",")).is("closed_at", null).gte("opened_at", new Date(Date.now() - 60000).toISOString());
      data?.forEach(row => handle(row as Parameters<typeof handle>[0]));
    };
    void poll();
    const retry = setInterval(() => void poll(), 8000);
    void channel.subscribe();
    return () => {
      clearInterval(retry);
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      void client.removeChannel(channel);
    };
    // `ids` is the stable identity of the conversation set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, profile.id]);

  return { ping, dismiss: () => setPing(null), accept: (item: ActivityPing) => { setPing(null); onOpen(item.conversationId, item.kind); } };
}

/** Bumps a conversation's shared activity so the partner is pulled in. */
export async function openSharedActivity(conversationId: string, kind: ActivityKind, ref?: string | null) {
  await rpc("open_activity", { p_conversation: conversationId, p_kind: kind, p_ref: ref ?? null });
}

export async function closeSharedActivity(conversationId: string) {
  await rpc("close_activity", { p_conversation: conversationId }).catch(() => undefined);
}

export function ActivityBanner({ ping, onJoin, onDismiss }: { ping: ActivityPing; onJoin: () => void; onDismiss: () => void }) {
  const copy = NAMES[ping.kind];
  const [left, setLeft] = useState(12);
  useEffect(() => {
    const tick = setInterval(() => setLeft(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(tick);
  }, []);
  return <div className={"activity-banner " + ping.kind} role="status">
    <span className="activity-emoji" aria-hidden="true">{copy.icon}</span>
    <span className="activity-copy"><strong>{ping.name} {copy.verb}</strong><small>Tap to join · {left}s</small></span>
    <button className="activity-join" onClick={() => { haptic("light"); onJoin(); }}>Join</button>
    <button className="activity-skip" aria-label="Dismiss" onClick={onDismiss}>✕</button>
  </div>;
}
