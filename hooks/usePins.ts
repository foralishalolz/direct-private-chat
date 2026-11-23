import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db, rpc } from "@/lib/supabase";
import type { Message, Profile } from "@/lib/types";

export type Pin = {
  message_id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  media_kind: Message["media_kind"];
  kind: Message["kind"];
  created_at: string;
  pinned_by: string;
  pinned_at: string;
  author?: Partial<Profile>;
};

/**
 * Pinned messages for one chat. The RPC returns the whole tray in one round
 * trip; Postgres changes on `conversation_pins` keep every open thread in sync
 * without polling.
 */
export function usePins(conversationId: string) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await rpc<Pin[]>("conversation_pins_list", { p_conversation: conversationId });
      if (alive.current) { setPins(Array.isArray(rows) ? rows : []); setError(""); }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "");
    }
  }, [conversationId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const client = db();
    let channel: RealtimeChannel | null = client
      .channel("pins:" + conversationId + ":" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_pins", filter: "conversation_id=eq." + conversationId }, () => { void refresh(); })
      .subscribe();
    return () => { alive.current = false; if (channel) { void client.removeChannel(channel); channel = null; } };
  }, [conversationId, refresh]);

  const set = useCallback(async (messageId: string, pinned: boolean) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await rpc(pinned ? "pin_message" : "unpin_message", pinned ? { p_message: messageId } : { p_message: messageId });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pin that message.");
      throw cause;
    } finally { if (alive.current) setBusy(false); }
  }, [busy, refresh]);

  const isPinned = useCallback((messageId: string) => pins.some(pin => pin.message_id === messageId), [pins]);

  return { pins, error, busy, refresh, set, isPinned };
}
