"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearNotifications, notifyMessage, UUID } from "@/lib/notifications";
import type { Message } from "@/lib/types";

export function useNotifications(userId: string, selected: string | null, onOpen: (id: string) => void) {
  const [toast, setToast] = useState<string | null>(null);
  const current = useRef(selected), alive = useRef(true), open = useRef(onOpen), seen = useRef(new Set<string>());
  current.current = selected; open.current = onOpen;
  useEffect(() => {
    alive.current = true;
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "bitchat-open-chat" && data.userId === userId && typeof data.conversationId === "string" && UUID.test(data.conversationId)) { open.current(data.conversationId); setToast(null); }
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", receive);
    const url = new URL(location.href), id = url.searchParams.get("chat");
    if (id) {
      if (url.searchParams.get("account") === userId && UUID.test(id)) open.current(id);
      url.searchParams.delete("chat"); url.searchParams.delete("account"); history.replaceState(null, "", url);
    }
    return () => { alive.current = false; if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", receive); void clearNotifications(userId).catch(() => {}); };
  }, [userId]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);
  const onMessage = useCallback((message: Partial<Message>) => {
    if (!alive.current || message.user_id === userId || !message.id || !message.conversation_id || !UUID.test(message.conversation_id) || seen.current.has(message.id)) return;
    const age = Date.now() - Date.parse(message.created_at ?? "");
    if (!Number.isFinite(age) || age > 60000 || age < -60000) return;
    seen.current.add(message.id); if (seen.current.size > 200) seen.current.delete(seen.current.values().next().value!);
    if (document.visibilityState === "visible") { if (current.current !== message.conversation_id) setToast(message.conversation_id); }
    else void notifyMessage(userId, message.conversation_id, message.id, () => alive.current).catch(() => {});
  }, [userId]);
  return { onMessage, toast, dismiss: () => setToast(null) };
}
