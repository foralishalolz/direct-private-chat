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

function readStoredQueue<T>(storageKey: string): OutboxItem<T>[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxItem<T>[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useOutbox<T>({
  storageKey,
  send,
  onSent,
  onFailed,
}: UseOutboxOptions<T>) {
  // Hydrate synchronously on the client so a queued message from a previous
  // session is visible immediately, then keep it in sync below.
  const [queue, setQueue] = useState<OutboxItem<T>[]>(() =>
    typeof window === "undefined" ? [] : readStoredQueue<T>(storageKey),
  );
  const [flushing, setFlushing] = useState(false);
  const queueRef = useRef<OutboxItem<T>[]>([]);
  const sendRef = useRef(send);
  const onSentRef = useRef(onSent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable indirection so the retry timer can call the latest flush without
  // referencing it before its declaration.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  // Guards against overlapping drains: without this, two "online" events can
  // both start flushing and send the same message twice.
  const drainingRef = useRef(false);

  useEffect(() => {
    sendRef.current = send;
    onSentRef.current = onSent;
  }, [send, onSent]);

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

  // Seed the ref from the hydrated state once, so flushing works immediately.
  useEffect(() => {
    queueRef.current = queue;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    if (drainingRef.current || queueRef.current.length === 0) return;
    drainingRef.current = true;
    setFlushing(true);

    let items = queueRef.current;

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
        timerRef.current = setTimeout(() => void flushRef.current(), delay);
        break;
      }
    }

    // Anything enqueued while we were draining starts its own pass.
    drainingRef.current = false;
    setFlushing(false);
  }, [onFailed, persist]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

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
