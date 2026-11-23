"use client";
import { useEffect, useRef, useState } from "react";

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
  const seen = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;
    const accept = (callId: string, conversationId: string, action: string) => {
      if (!UUID.test(callId) || !UUID.test(conversationId)) return;
      const key = callId + ":" + action;
      if (seen.current === key) return;
      seen.current = key;
      setIntent({ callId, conversationId, action: action === "accept" || action === "decline" ? action : "open" });
    };

    const message = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "bitchat-open-call" || data.userId !== userId) return;
      accept(String(data.callId ?? ""), String(data.conversationId ?? ""), String(data.action ?? "open"));
    };
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

    return () => { if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", message); };
  }, [userId, enabled]);

  return { intent, clear: () => { setIntent(null); seen.current = ""; } };
}
