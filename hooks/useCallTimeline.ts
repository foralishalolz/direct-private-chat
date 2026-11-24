import { useEffect, useState } from "react";
import { db, rpc } from "@/lib/supabase";
import type { CallRow } from "@/lib/rtc";

/** Recent calls are a separate record, not synthetic messages. */
export function useCallTimeline(conversationId: string, enabled: boolean) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  useEffect(() => {
    if (!enabled) { setCalls([]); return; }
    let alive = true, generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const rows = await rpc<CallRow[]>("call_history", { p_conversation: conversationId, p_limit: 40 });
        if (alive && request === generation) setCalls(Array.isArray(rows) ? rows : []);
      } catch { /* The chat stays usable when call history is unavailable. */ }
    };
    const client = db();
    const channel = client.channel("call-timeline:" + conversationId)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: "conversation_id=eq." + conversationId }, () => void load())
      .subscribe(status => { if (status === "SUBSCRIBED") void load(); });
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => { alive = false; document.removeEventListener("visibilitychange", visible); void client.removeChannel(channel); };
  }, [conversationId, enabled]);
  return calls;
}
