"use client";
import { useEffect } from "react";
import { db } from "@/lib/supabase";
import { acknowledge, announce, pending, updatePending, type Pending } from "@/lib/offline";
import type { Message } from "@/lib/types";

const running = new Set<string>();
export function useOutbox(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    let active = true, busy = false, heldElsewhere = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const drain = async () => {
      if (running.has(userId)) { heldElsewhere = true; return; }
      running.add(userId);
      try {
        const { data: { session } } = await db().auth.getSession();
        if (!session || session.user.id !== userId) return;
        // Drain new drafts as soon as an in-flight request completes.
        // Preserve account send order; UUIDs make uncertain retries idempotent.
        let sent = 0;
        while (active && navigator.onLine && sent < 20) {
          const due = (await pending(userId)).filter(row => !row.failed && row.nextAt <= Date.now());
          if (!due.length) break;
          for (const row of due) {
            if (!active || !navigator.onLine || sent >= 20) break;
            sent++;
            const { id, conversation_id, user_id, content, media_url, media_kind, kind, reply_to } = row.message;
            let { data, error } = await db().from("messages").insert({ id, conversation_id, user_id, content, media_url, media_kind, kind, reply_to: reply_to ?? null }).select("*").abortSignal(abort.signal).single();
            if (!active) break;
            if (error?.code === "23505") {
              const result = await db().from("messages").select("*").eq("id", id).eq("user_id", userId).abortSignal(abort.signal).maybeSingle();
              data = result.data; error = result.error ?? (result.data ? null : error);
            }
            if (!active) break;
            if (!error && data) { await acknowledge(userId, id); announce(userId, data as Message); continue; }
            if (error?.message?.includes("Message was removed")) { await acknowledge(userId, id); announce(userId, undefined, id); continue; }
            const next: Pending = { ...row, attempts: row.attempts + 1, nextAt: Date.now() + Math.min(60000, 2000 * 2 ** Math.min(row.attempts, 5)), failed: !!error && /42501|23503|23514|P0001/.test(error.code ?? "") };
            await updatePending(next);
          }
        }
      } finally { running.delete(userId); }
    };
    const run = async () => {
      if (!active || busy || !navigator.onLine || document.visibilityState === "hidden") return;
      busy = true; heldElsewhere = false; clearTimeout(timer); let retryDelay = 60;
      try {
        if (navigator.locks) await navigator.locks.request("bitchat-send:" + userId, { ifAvailable: true }, async lock => { if (lock) await drain(); else heldElsewhere = true; });
        else await drain();
      } catch { retryDelay = 1500; /* Transient errors retry without spinning. */ }
      finally {
        busy = false;
        if (active && navigator.onLine) {
          const rows = (await pending(userId)).filter(row => !row.failed);
          if (rows.length) {
            const nextAt = Math.min(...rows.map(row => row.nextAt));
            timer = setTimeout(() => void run(), heldElsewhere ? 1500 : Math.max(retryDelay, Math.min(60000, nextAt - Date.now())));
          }
        }
      }
    };
    const wake = () => { void run(); };
    window.addEventListener("online", wake); window.addEventListener("bitchat-outbox", wake); document.addEventListener("visibilitychange", wake); wake();
    return () => { active = false; abort.abort(); clearTimeout(timer); window.removeEventListener("online", wake); window.removeEventListener("bitchat-outbox", wake); document.removeEventListener("visibilitychange", wake); };
  }, [userId]);
}
