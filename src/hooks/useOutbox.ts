"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Offline-first send queue.
 *
 * Every message goes to the queue first, then the flusher drains it in order.
 * If the browser is offline — or a request bombs out on a flaky mobile
 * connection — the item stays queued and is retried with exponential backoff
 * once connectivity returns. This is what makes sending feel instant on slow
 * internet: the UI never waits on the network.
 */

export interface OutboxItem<T> {
  id: string;
  payload: T;
  attempts: number;
  createdAt: number;
}

interface UseOutboxOptions<T> {
  storageKey: string;
  send: (payload: T) => Promise<void>;
  /** Called once the network accepted an item (used to settle "sending"). */
  onSent?: (item: OutboxItem<T>) => void;
  onFailed?: (item: OutboxItem<T>, error: unknown) => void;
}

const MAX_ATTEMPTS = 6;

export function useOutbox<T>({
  storageKey,
  send,
  onSent,
  onFailed,
}: UseOutboxOptions<T>) {
  const [queue, setQueue] = useState<OutboxItem<T>[]>([]);
  const [flushing, setFlushing] = useState(false);
  const queueRef = useRef<OutboxItem<T>[]>([]);
  const sendRef = useRef(send);
  const onSentRef = useRef(onSent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  sendRef.current = send;
  onSentRef.current = onSent;

  const persist = useCallback(
    (items: OutboxItem<T>[]) => {
      queueRef.current = items;
      setQueue(items);
      try {
        if (items.length === 0) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, JSON.stringify(items.slice(-40)));
        }
      } catch {
        /* storage full or blocked — queue still lives in memory */
      }
    },
    [storageKey],
  );

  // Rehydrate anything left over from a previous session.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as OutboxItem<T>[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          queueRef.current = parsed;
          setQueue(parsed);
        }
      }
    } catch {
      /* ignore corrupt payloads */
    }
  }, [storageKey]);

  const flush = useCallback(async () => {
    if (flushing || queueRef.current.length === 0) return;
    setFlushing(true);

    let items = [...queueRef.current];

    while (items.length > 0) {
      if (typeof navigator !== "undefined" && !navigator.onLine) break;

      const [head, ...rest] = items;

      try {
        await sendRef.current(head.payload);
        items = rest;
        persist(items);
        onSentRef.current?.(head);
      } catch (error) {
        const attempts = head.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          onFailed?.(head, error);
          items = rest;
          persist(items);
          continue;
        }

        const updatedHead = { ...head, attempts };
        items = [updatedHead, ...rest];
        persist(items);

        // Exponential backoff: 800ms, 1.6s, 3.2s, 6.4s, 12.8s.
        const delay = Math.min(800 * 2 ** (attempts - 1), 12_800);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void flush(), delay);
        break;
      }
    }

    setFlushing(false);
  }, [flushing, onFailed, persist]);

  const enqueue = useCallback(
    (id: string, payload: T) => {
      const item: OutboxItem<T> = {
        id,
        payload,
        attempts: 0,
        createdAt: Date.now(),
      };
      persist([...queueRef.current, item]);
      void flush();
    },
    [flush, persist],
  );

  const remove = useCallback(
    (id: string) => {
      persist(queueRef.current.filter((item) => item.id !== id));
    },
    [persist],
  );

  // Auto-flush when we come back online or the tab regains focus.
  useEffect(() => {
    function handleOnline() {
      void flush();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") void flush();
    }

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    void flush();

    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    queue,
    pendingIds: new Set(queue.map((item) => item.id)),
    enqueue,
    remove,
    flush,
    flushing,
  };
}
