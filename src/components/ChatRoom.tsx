"use client";

import {
  ArrowLeft,
  ImageIcon,
  LoaderCircle,
  Paperclip,
  Send,
  Video,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageBubble } from "@/components/MessageBubble";
import { markGroupRead } from "@/components/GroupList";
import { validateMediaFile, uploadMedia } from "@/lib/media";
import { dayLabel } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Group, MessageCursor, Profile } from "@/types/chat";

const PAGE_SIZE = 30;
const POLL_INTERVAL_MS = 4000;

type ConnectionMode = "connected" | "reconnecting" | "offline";

interface ChatRoomProps {
  user: User;
  currentProfile: Profile | null;
  group: Group;
  onBack: () => void;
  initialMessageId?: string | null;
}

function compareMessages(left: ChatMessage, right: ChatMessage) {
  const timeDifference =
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  if (timeDifference !== 0) return timeDifference;
  return left.id.localeCompare(right.id);
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort(compareMessages);
}

export function ChatRoom({
  user,
  currentProfile,
  group,
  onBack,
  initialMessageId,
}: ChatRoomProps) {
  const client = supabase;
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const profilesRef = useRef<Record<string, string>>({});
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(true);
  const initialLoadCompleteRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [composerError, setComposerError] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionMode>("reconnecting");
  const [flashId, setFlashId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  // Mark the group read when the chat is open.
  useEffect(() => {
    markGroupRead(group.id);
  }, [group.id]);

  useEffect(() => {
    const footer = footerRef.current;
    const scrollElement = scrollRef.current;
    if (!footer || !scrollElement) return;

    function updateScrollInset() {
      if (!footer || !scrollElement) return;
      const distanceFromBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      scrollElement.style.bottom = `${footer.getBoundingClientRect().height}px`;
      if (distanceFromBottom < 80) {
        window.requestAnimationFrame(() => scrollElement.scrollTop = scrollElement.scrollHeight);
      }
    }

    const observer = new ResizeObserver(updateScrollInset);
    observer.observe(footer);
    updateScrollInset();

    return () => observer.disconnect();
  }, []);

  const fetchPage = useCallback(
    async (before?: MessageCursor) => {
      if (!client) return [] as ChatMessage[];

      let query = client
        .from("messages")
        .select("id, group_id, user_id, content, created_at, media_url, media_type, media_name, media_size")
        .eq("group_id", group.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (before) {
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      }

      const { data, error } = await query;
      if (error || !data) return [] as ChatMessage[];

      return data as ChatMessage[];
    },
    [client, group.id],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const ensureProfile = useCallback(
    async (userId: string) => {
      if (!client || profilesRef.current[userId]) return;

      const { data } = await client
        .from("profiles")
        .select("id, username")
        .eq("id", userId)
        .maybeSingle();

      if (!data) return;

      setProfiles((current) => ({
        ...current,
        [data.id as string]: data.username as string,
      }));
    },
    [client],
  );

  const isNearBottom = useCallback((threshold = 160) => {
    const element = scrollRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  }, []);

  useEffect(() => {
    if (!client) return;

    let active = true;
    const connectedClient = client;

    const realtimeChannel = connectedClient
      .channel(`group-messages-${group.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${group.id}`,
        },
        (payload) => {
          if (!active) return;

          const message = payload.new as ChatMessage;

          setMessages((current) => mergeMessages(current, [message]));
          void ensureProfile(message.user_id);

          if (isNearBottom(160) || message.user_id === user.id) {
            window.requestAnimationFrame(() => scrollToBottom("smooth"));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${group.id}`,
        },
        (payload) => {
          if (!active) return;
          setMessages((current) => mergeMessages(current, [payload.new as ChatMessage]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${group.id}`,
        },
        (payload) => {
          if (!active) return;
          const deletedId = (payload.old as { id?: string }).id;
          if (!deletedId) return;
          setMessages((current) => current.filter((message) => message.id !== deletedId));
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setConnection("connected");
        } else if (status === "CLOSED") {
          setConnection("offline");
        } else {
          setConnection("reconnecting");
        }
      });

    async function initialize() {
      const [profilesResult, firstPage] = await Promise.all([
        connectedClient.from("profiles").select("id, username"),
        fetchPage(),
      ]);

      if (!active) return;

      if (profilesResult.data) {
        const profileMap = Object.fromEntries(
          profilesResult.data.map((profile) => [profile.id as string, profile.username as string]),
        );
        setProfiles(profileMap);
        profilesRef.current = profileMap;
      }

      setMessages((current) => mergeMessages(current, firstPage));
      hasMoreRef.current = firstPage.length === PAGE_SIZE;
      initialLoadCompleteRef.current = true;
      setIsInitialLoading(false);
      window.requestAnimationFrame(() => scrollToBottom());
    }

    void initialize();

    return () => {
      active = false;
      void connectedClient.removeChannel(realtimeChannel);
    };
  }, [client, ensureProfile, fetchPage, group.id, isNearBottom, scrollToBottom, user.id]);

  // Polling fallback whenever realtime is not connected — keeps a live feed on
  // flaky/slow networks (doubles as an offline queue drainer when the tab is
  // backgrounded).
  useEffect(() => {
    if (connection === "connected") return;

    let active = true;

    async function tick() {
      const page = await fetchPage();
      if (!active || page.length === 0) return;
      setMessages((current) => {
        const merged = mergeMessages(current, page);
        if (merged.length !== current.length && isNearBottom(200)) {
          window.requestAnimationFrame(() => scrollToBottom("smooth"));
        }
        return merged;
      });
    }

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [connection, fetchPage, isNearBottom, scrollToBottom]);

  // Jump to a search-highlighted message after the initial load.
  useEffect(() => {
    if (!initialMessageId) return;
    const messageId = initialMessageId;
    let active = true;

    async function jump() {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (!active) return;
        const element = scrollRef.current?.querySelector(`[data-message-id="${messageId}"]`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          setFlashId(messageId);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashId(null), 2600);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    void jump();
    return () => {
      active = false;
    };
  }, [initialMessageId]);

  const loadOlder = useCallback(async () => {
    const element = scrollRef.current;
    const oldestMessage = messagesRef.current[0];

    if (
      !element ||
      !oldestMessage ||
      !initialLoadCompleteRef.current ||
      loadingOlderRef.current ||
      !hasMoreRef.current
    ) {
      return;
    }

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);

    const previousScrollHeight = element.scrollHeight;
    const previousScrollTop = element.scrollTop;
    const olderMessages = await fetchPage({
      id: oldestMessage.id,
      created_at: oldestMessage.created_at,
    });

    hasMoreRef.current = olderMessages.length === PAGE_SIZE;

    if (olderMessages.length > 0) {
      setMessages((current) => mergeMessages(current, olderMessages));

      window.requestAnimationFrame(() => {
        const updatedElement = scrollRef.current;
        if (!updatedElement) return;
        const addedHeight = updatedElement.scrollHeight - previousScrollHeight;
        updatedElement.scrollTop = previousScrollTop + addedHeight;
      });
    }

    loadingOlderRef.current = false;
    setIsLoadingOlder(false);
  }, [fetchPage]);

  function handleScroll() {
    const element = scrollRef.current;
    if (element && element.scrollTop < 120) void loadOlder();
  }

  function resetComposerHeight() {
    if (composerRef.current) composerRef.current.style.height = "24px";
  }

  async function sendMessage(payload: {
    id?: string;
    content: string;
    media?: { url: string; type: "image" | "video"; name: string; size: number } | null;
    retry?: boolean;
  }): Promise<void> {
    if (!client || isSending) return;

    const trimmed = payload.content.trim();
    if (!trimmed && !payload.media) return;

    setIsSending(true);

    const messageId = payload.id ?? crypto.randomUUID();
    const optimistic: ChatMessage = {
      id: messageId,
      group_id: group.id,
      user_id: user.id,
      content: trimmed,
      created_at: new Date().toISOString(),
      media_url: payload.media?.url ?? null,
      media_type: payload.media?.type ?? null,
      media_name: payload.media?.name ?? null,
      media_size: payload.media?.size ?? null,
      client_pending: true,
    };

    if (payload.retry) {
      // Keep the existing optimistic message but flip it to pending again.
      setMessages((current) =>
        current.map((m) =>
          m.id === messageId
            ? { ...m, client_pending: true, client_failed: false, content: trimmed, media_url: optimistic.media_url, media_type: optimistic.media_type, media_name: optimistic.media_name, media_size: optimistic.media_size }
            : m,
        ),
      );
    } else {
      setMessages((current) => mergeMessages(current, [optimistic]));
    }

    setContent("");
    resetComposerHeight();
    window.requestAnimationFrame(() => scrollToBottom("smooth"));

    const { data, error } = await client
      .from("messages")
      .insert({
        id: messageId,
        group_id: group.id,
        user_id: user.id,
        content: trimmed,
        media_url: payload.media?.url ?? null,
        media_type: payload.media?.type ?? null,
        media_name: payload.media?.name ?? null,
        media_size: payload.media?.size ?? null,
      })
      .select("id, group_id, user_id, content, created_at, media_url, media_type, media_name, media_size")
      .single();

    if (error || !data) {
      const persistenceCheck = await client
        .from("messages")
        .select("id, group_id, user_id, content, created_at, media_url, media_type, media_name, media_size")
        .eq("id", messageId)
        .maybeSingle();

      if (persistenceCheck.data) {
        setMessages((current) => mergeMessages(current, [persistenceCheck.data as ChatMessage]));
        setIsSending(false);
        return;
      }

      setMessages((current) => {
        if (!payload.retry) {
          return current.filter((m) => m.id !== messageId);
        }
        return current.map((m) =>
          m.id === messageId ? { ...m, client_pending: false, client_failed: true } : m,
        );
      });

      if (!payload.retry) {
        setContent(trimmed);
      }
      setComposerError((attempt) => attempt + 1);
      setIsSending(false);
      return;
    }

    setMessages((current) => mergeMessages(current, [data as ChatMessage]));
    setIsSending(false);
  }

  // Send a push event to the server (the Authorization header carries the user).
  async function pushMessage(payload: Record<string, unknown>) {
    if (!client) return;
    const {
      data: { session },
    } = await client.auth.getSession();

    if (!session?.access_token) return;

    await fetch("/api/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!client || isSending) return;

    const nextContent = content.trim();
    if (!nextContent && !pendingFile) return;

    let media: { url: string; type: "image" | "video"; name: string; size: number } | null = null;

    if (pendingFile) {
      const validated = validateMediaFile(pendingFile);
      if ("error" in validated) {
        setAttachmentError(validated.error);
        setPendingFile(null);
        return;
      }
      const uploaded = await uploadMedia(client, pendingFile, user.id, validated.type);
      if ("error" in uploaded) {
        setAttachmentError(uploaded.error);
        return;
      }
      media = {
        url: uploaded.url,
        type: validated.type,
        name: pendingFile.name,
        size: pendingFile.size,
      };
      setPendingFile(null);
      setAttachmentError(null);
    }

    await sendMessage({ content: nextContent, media });

    // Best-effort push to the group (sender's client triggers it).
    const senderName = currentProfile?.username ?? user.email?.split("@")[0] ?? "Someone";
    const preview = media
      ? media.type === "video"
        ? "🎥 Video"
        : "🖼️ Photo"
      : nextContent;
    void pushMessage({
      type: "message",
      groupId: group.id,
      senderName,
      body: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview,
    });
  }

  function handleRetry(messageId: string) {
    const message = messagesRef.current.find((m) => m.id === messageId);
    if (!message) return;

    const media = message.media_url
      ? {
          url: message.media_url,
          type: (message.media_type ?? "image") as "image" | "video",
          name: message.media_name ?? "media",
          size: message.media_size ?? 0,
        }
      : null;

    void sendMessage({
      id: message.id,
      content: message.content,
      media,
      retry: true,
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleOptimisticUpdate(id: string, nextContent: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, content: nextContent } : message,
      ),
    );
  }

  function handleOptimisticDelete(id: string) {
    setMessages((current) => current.filter((message) => message.id !== id));
  }

  function openAttachmentPicker() {
    fileInputRef.current?.click();
  }

  function handleFilePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setAttachmentError(null);
    const validated = validateMediaFile(file);
    if ("error" in validated) {
      setAttachmentError(validated.error);
      return;
    }
    setPendingFile(file);
  }

  function clearPendingFile() {
    setPendingFile(null);
    setAttachmentError(null);
  }

  const fallbackUsername = useMemo(
    () => user.email?.split("@")[0] ?? "",
    [user.email],
  );

  const statusLabel =
    connection === "connected" ? "Live" : connection === "reconnecting" ? "Reconnecting…" : "Offline — polling";
  const statusColor =
    connection === "connected"
      ? "bg-[var(--success)]"
      : connection === "reconnecting"
        ? "bg-amber-400"
        : "bg-[var(--danger)]";

  if (!client) return null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--bg)]">
      <header className="safe-header fixed inset-x-0 top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-2)]/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chats"
            className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--text)] transition hover:bg-[var(--hover)] active:scale-95"
          >
            <ArrowLeft aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </button>

          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-2xl text-[15px] font-semibold text-white"
              style={{ background: "var(--grad-accent)" }}
            >
              {group.name.charAt(0).toUpperCase() || "#"}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-[15px] font-semibold leading-tight text-[var(--text)]">
                  {group.name}
                </div>
                <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${statusColor}`} />
              </div>
              <div className="truncate text-[11px] leading-tight text-[var(--text-muted)]">
                {currentProfile?.username ?? fallbackUsername} · {statusLabel}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-scroll no-scrollbar absolute inset-x-0 bottom-[var(--chat-composer-height)] top-[var(--chat-header-height)] overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-1.5 px-3 py-4 sm:px-5">
          {isLoadingOlder && (
            <div className="grid h-9 shrink-0 place-items-center">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.6} />
            </div>
          )}

          {isInitialLoading ? (
            <div className="grid min-h-[40dvh] place-items-center">
              <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-[var(--text-muted)]" strokeWidth={1.6} />
            </div>
          ) : (
            (() => {
              const items: ReactNode[] = [];
              let lastDay: string | null = null;
              messages.forEach((message, index) => {
                const day = message.created_at ? new Date(message.created_at).toDateString() : null;
                const label = day ? dayLabel(message.created_at) : null;
                if (label && label !== lastDay) {
                  lastDay = label;
                  items.push(
                    <div key={`day-${label}-${index}`} className="my-1 flex justify-center">
                      <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1 text-[11px] font-medium text-[var(--text-muted)]">
                        {label}
                      </span>
                    </div>,
                  );
                }
                const previousMessage = messages[index - 1];
                const nextMessage = messages[index + 1];
                const isOwn = message.user_id === user.id;
                items.push(
                  <MessageBubble
                    key={message.id}
                    message={message}
                    username={
                      profiles[message.user_id] ??
                      (isOwn ? currentProfile?.username ?? fallbackUsername : "")
                    }
                    isOwn={isOwn}
                    canManage={isOwn}
                    showUsername={!previousMessage || previousMessage.user_id !== message.user_id}
                    showAvatar={!nextMessage || nextMessage.user_id !== message.user_id}
                    flash={flashId === message.id}
                    onUpdate={handleOptimisticUpdate}
                    onDelete={handleOptimisticDelete}
                    onRetry={handleRetry}
                  />,
                );
              });
              if (items.length === 0) {
                items.push(
                  <div key="empty" className="grid min-h-[40dvh] place-items-center">
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                      <span
                        aria-hidden="true"
                        className="grid size-16 place-items-center rounded-3xl text-white"
                        style={{ background: "var(--grad-accent)" }}
                      >
                        <Send aria-hidden="true" className="size-7" strokeWidth={1.6} />
                      </span>
                      <p className="text-[15px] font-semibold">Be the first to say something</p>
                      <p className="max-w-[28ch] text-sm text-[var(--text-muted)]">
                        Send a message, photo or video to get the conversation started.
                      </p>
                    </div>
                  </div>,
                );
              }
              return items;
            })()
          )}
        </div>
      </div>

      {connection !== "connected" && (
        <div className="fixed inset-x-0 bottom-[110px] z-30 mx-auto w-fit">
          <div className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/15 px-3.5 py-1.5 text-[12px] font-medium text-amber-300 shadow-lg backdrop-blur">
            <span className="size-2 animate-pulse rounded-full bg-amber-400" />
            {connection === "offline" ? "Offline — showing last known messages" : "Reconnecting… live updates will resume"}
          </div>
        </div>
      )}

      <footer
        ref={footerRef}
        className="safe-composer fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--bg-2)]/85 backdrop-blur-2xl"
      >
        <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-4">
          {attachmentError && (
            <p role="alert" className="mb-2 text-[13px] font-medium text-[var(--danger)]">
              {attachmentError}
            </p>
          )}

          {pendingFile && (
            <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
              <span
                aria-hidden="true"
                className="grid size-9 place-items-center rounded-lg text-white"
                style={{ background: "var(--grad-accent)" }}
              >
                {pendingFile.type.startsWith("video/") ? (
                  <Video aria-hidden="true" className="size-4" strokeWidth={1.8} />
                ) : (
                  <ImageIcon aria-hidden="true" className="size-4" strokeWidth={1.8} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[var(--text)]">{pendingFile.name}</p>
                <p className="text-[11px] text-[var(--text-faint)]">
                  {pendingFile.type.startsWith("video/") ? "Video" : "Image"} · {(pendingFile.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={clearPendingFile}
                aria-label="Remove attachment"
                className="grid size-8 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--hover)]"
              >
                <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
              </button>
            </div>
          )}

          <form
            key={composerError}
            onSubmit={handleSend}
            className={`flex items-end gap-2 ${composerError > 0 ? "animate-chat-shake" : ""}`}
          >
            <button
              type="button"
              onClick={openAttachmentPicker}
              aria-label="Attach a photo or video"
              className="grid size-12 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text-muted)] transition hover:text-[var(--text)] active:scale-95"
            >
              <Paperclip aria-hidden="true" className="size-5" strokeWidth={1.8} />
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFilePick}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />

            <div className="flex min-h-12 min-w-0 flex-1 items-end rounded-[22px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5">
              <textarea
                ref={composerRef}
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  event.target.style.height = "24px";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 112)}px`;
                }}
                onKeyDown={handleComposerKeyDown}
                rows={1}
                maxLength={4000}
                placeholder="Message"
                aria-label="Message"
                enterKeyHint="send"
                className="my-2 min-h-6 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 text-[15px] leading-6 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>

            <button
              type="submit"
              disabled={isSending || (!content.trim() && !pendingFile)}
              aria-label="Send"
              className="btn-accent grid size-12 shrink-0 place-items-center rounded-full transition active:scale-95"
            >
              {isSending ? (
                <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={1.8} />
              ) : (
                <Send aria-hidden="true" className="size-[19px] -translate-x-px" strokeWidth={1.9} />
              )}
            </button>
          </form>
        </div>
      </footer>
    </main>
  );
}
