"use client";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/supabase";

export type IncomingIntent = { callId: string; conversationId: string; action: "open" | "accept" | "decline" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A phone call should reach you from the lock screen, not the inbox.
 *
 * Two doors lead here: the service worker posts `bitchat-open-call` after an
 * Answer / Decline tap, and a cold launch arrives as `?call=…&chat=…&accept=1`.
 * Both are normalised into one intent the inbox can act on.
 */
export function useIncomingCall(userId: string, enabled = true) {
  const [intent, setIntent] = useState<IncomingIntent | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const accept = (callId: string, conversationId: string, action: string) => {
      if (!UUID.test(callId) || !UUID.test(conversationId)) return;
      const key = callId + ":" + action;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (seen.current.size > 100) seen.current = new Set([...seen.current].slice(-50));
      setIntent({ callId, conversationId, action: action === "accept" || action === "decline" ? action : "open" });
    };

    const message = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "bitchat-open-call" || data.userId !== userId) return;
      accept(String(data.callId ?? ""), String(data.conversationId ?? ""), String(data.action ?? "open"));
    };
    // Foreground rings must reach the user even when no conversation is open.
    const client = db(); let disposed = false;
    const receive = (row: { id?: string; conversation_id?: string; callee?: string; status?: string; started_at?: string }) => {
      if (disposed || row.callee !== userId || row.status !== "ringing" || !row.id || !row.conversation_id || !row.started_at || Date.now() - Date.parse(row.started_at) > 55000) return;
      accept(row.id, row.conversation_id, "open");
    };
    const channel = client.channel("incoming-global:" + userId).on("postgres_changes", { event:"INSERT", schema:"public", table:"calls", filter:"callee=eq." + userId }, event => receive(event.new)).subscribe();
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await client.from("calls").select("id,conversation_id,callee,status,started_at").eq("callee", userId).eq("status", "ringing").gte("started_at",new Date(Date.now()-55000).toISOString()).order("started_at",{ascending:false}).limit(1);
      if (!disposed && data?.[0]) receive(data[0]);
    };
    void poll(); const timer = setInterval(() => void poll(), 8000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", message);

    const url = new URL(location.href);
    const callId = url.searchParams.get("call"), conversationId = url.searchParams.get("chat");
    const account = url.searchParams.get("account");
    if (callId && conversationId && (!account || account === userId)) {
      const action = url.searchParams.get("decline") ? "decline" : url.searchParams.get("accept") ? "accept" : "open";
      accept(callId, conversationId, action);
      url.searchParams.delete("call"); url.searchParams.delete("accept"); url.searchParams.delete("decline");
      history.replaceState(null, "", url);
    }

    return () => { disposed = true; clearInterval(timer); void client.removeChannel(channel); if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", message); };
  }, [userId, enabled]);

  return { intent, clear: () => setIntent(null) };
}
