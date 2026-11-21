"use client";

import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Mic,
  LoaderCircle,
  Paperclip,
  Reply,
  Settings,
  Smile,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChatStore } from "@/hooks/useChatStore";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useOutbox } from "@/hooks/useOutbox";
import { supabase } from "@/lib/supabase";
import { isSupportedMedia, mediaKindFor, uploadMedia } from "@/lib/media";
import { playSent, playSparkle, primeAudio } from "@/lib/sound";
import {
  displayName,
  formatDayLabel,
  lastSeenLabel,
  safeRandomId,
  vibrate,
} from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Misc";
import {
  MessageBubble,
  type ReplyContext,
} from "@/components/chat/MessageBubble";
import { MediaPicker } from "@/components/chat/MediaPicker";
import { Lightbox } from "@/components/chat/Lightbox";
import { ChatInfoSheet } from "@/components/chat/ChatInfoSheet";
import { TypingDots } from "@/components/chat/TypingDots";
import { LOVE_PROMPTS } from "@/lib/stickers";
import type {
  ChatMessage,
  Group,
  MessageCursor,
  Profile,
  Reaction,
  TypingState,
} from "@/types/chat";

const PAGE_SIZE = 30;

interface ChatRoomProps {
  group: Group;
  onBack: () => void;
}

interface OutboxPayload {
  id: string;
  content: string;
  kind: ChatMessage["kind"];
  media_url: string | null;
  media_type: string | null;
  duration_seconds: number | null;
  reply_to_id: string | null;
}

function compareMessages(left: ChatMessage, right: ChatMessage) {
  const diff =
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  return diff !== 0 ? diff : left.id.localeCompare(right.id);
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    byId.set(message.id, {
      ...existing,
      ...message,
      // Keep optimistic state until the server copy lands.
      status: message.status ?? existing?.status,
    });
  }
  return Array.from(byId.values()).sort(compareMessages);
}

export function ChatRoom({ group, onBack }: ChatRoomProps) {
  const client = supabase;
  const { user, profile, groups, markGroupRead, onlineUserIds } = useChatStore();
  const network = useNetworkStatus();

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const profilesRef = useRef<Record<string, Profile>>({});
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(true);
  const initialLoadCompleteRef = useRef(false);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNearBottomRef = useRef(true);
  const readMarkRef = useRef(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [reads, setReads] = useState<Record<string, string[]>>({});
  const [typingUsers, setTypingUsers] = useState<TypingState[]>([]);
  const [content, setContent] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [composerError, setComposerError] = useState(0);
  const [replyTo, setReplyTo] = useState<ReplyContext | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [emojiRowOpen, setEmojiRowOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentUserId = user?.id ?? "";

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    markGroupRead(group.id);
    return () => {
      void markGroupRead(group.id);
    };
  }, [group.id, markGroupRead]);

  // ------------------------------------------------------------------ sending
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const notifyRecipients = useCallback(
    async (messageId: string) => {
      if (!client) return;
      try {
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        await fetch("/api/push/notify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId }),
          keepalive: true,
        });
      } catch {
        /* notifications are best-effort */
      }
    },
    [client],
  );

  const sendPayload = useCallback(
    async (payload: OutboxPayload) => {
      if (!client || !user) throw new Error("Not ready");

      const { error } = await client.from("messages").insert({
        id: payload.id,
        group_id: group.id,
        user_id: user.id,
        content: payload.content,
        kind: payload.kind,
        media_url: payload.media_url,
        media_type: payload.media_type,
        duration_seconds: payload.duration_seconds,
        reply_to_id: payload.reply_to_id,
      });

      if (error) {
        // Duplicate id means a retry already landed — treat as success.
        if (error.code === "23505") return;
        throw new Error(error.message);
      }

      // Fire-and-forget push fan-out for everyone else in this chat. Failure
      // here must never affect the sender's experience.
      void notifyRecipients(payload.id);
    },
    [client, group.id, notifyRecipients, user],
  );

  const { enqueue, remove } = useOutbox<OutboxPayload>({
    storageKey: `bitchat-outbox-${group.id}`,
    send: sendPayload,
    // Settle the bubble even when the realtime socket is asleep (slow
    // connection, backgrounded tab): the insert already succeeded.
    onSent: (item) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === item.id ? { ...message, status: "sent" } : message,
        ),
      );
    },
    onFailed: (item) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === item.id ? { ...message, status: "failed" } : message,
        ),
      );
      remove(item.id);
    },
  });

  const dispatchMessage = useCallback(
    (payload: OutboxPayload) => {
      const optimistic: ChatMessage = {
        id: payload.id,
        group_id: group.id,
        user_id: currentUserId,
        content: payload.content,
        kind: payload.kind,
        media_url: payload.media_url,
        media_type: payload.media_type,
        duration_seconds: payload.duration_seconds,
        reply_to_id: payload.reply_to_id,
        created_at: new Date().toISOString(),
        status: "sending",
      };

      setMessages((current) => mergeMessages(current, [optimistic]));
      scrollToBottom("smooth");
      enqueue(payload.id, payload);
      if (localStorage.getItem("bitchat-sounds") !== "off") playSent();
      vibrate(6);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, enqueue, group.id],
  );

  // ------------------------------------------------------------------ fetching
  const fetchPage = useCallback(
    async (before?: MessageCursor) => {
      if (!client) return [] as ChatMessage[];

      let query = client
        .from("messages")
        .select(
          "id, group_id, user_id, content, kind, media_url, media_type, duration_seconds, reply_to_id, created_at, edited_at, deleted_at",
        )
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

  const ensureProfiles = useCallback(
    async (userIds: string[]) => {
      if (!client) return;
      const missing = [...new Set(userIds)].filter(
        (id) => id && !profilesRef.current[id],
      );
      if (missing.length === 0) return;

      const { data } = await client
        .from("profiles")
        .select("id, username, display_name, avatar_url, accent, last_seen_at")
        .in("id", missing);

      if (!data || data.length === 0) return;

      setProfiles((current) => {
        const next = { ...current };
        for (const row of data) next[row.id as string] = row as Profile;
        profilesRef.current = next;
        return next;
      });
    },
    [client],
  );

  const loadReactions = useCallback(
    async (messageIds: string[]) => {
      if (!client || messageIds.length === 0) return;
      const { data } = await client
        .from("message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", messageIds);

      if (!data) return;

      setReactions((current) => {
        const next: Record<string, Reaction[]> = { ...current };
        for (const row of data) {
          const key = row.message_id as string;
          // Always clone the list — never mutate the array held in state.
          const list = [...(next[key] ?? [])];
          const already = list.some(
            (reaction) =>
              reaction.user_id === row.user_id && reaction.emoji === row.emoji,
          );
          if (!already) list.push(row as Reaction);
          next[key] = list;
        }
        return next;
      });
    },
    [client],
  );

  const loadReads = useCallback(
    async (messageIds: string[]) => {
      if (!client || messageIds.length === 0) return;
      const { data } = await client
        .from("message_reads")
        .select("message_id, user_id")
        .in("message_id", messageIds);

      if (!data) return;

      setReads((current) => {
        const next: Record<string, string[]> = { ...current };
        for (const row of data) {
          const key = row.message_id as string;
          const list = [...(next[key] ?? [])];
          if (!list.includes(row.user_id as string)) {
            list.push(row.user_id as string);
          }
          next[key] = list;
        }
        return next;
      });
    },
    [client],
  );

  // --------------------------------------------------------------- realtime
  useEffect(() => {
    if (!client || !user) return;

    let active = true;
    const connectedClient = client;

    const channel = connectedClient
      .channel(`group-${group.id}`, { config: { presence: { key: user.id } } })
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
          const nearBottom = isNearBottomRef.current;

          setMessages((current) => {
            // Drop an in-flight placeholder only when the server copy has the
            // same id (normal path) or, as a fallback for servers that assign
            // ids, when the same author already has an identical pending one.
            const withoutPlaceholder = current.filter(
              (item) =>
                !(
                  item.status === "sending" &&
                  item.user_id === message.user_id &&
                  item.id !== message.id &&
                  item.content === message.content &&
                  item.kind === message.kind
                ),
            );
            return mergeMessages(withoutPlaceholder, [
              { ...message, status: "sent" },
            ]);
          });

          void ensureProfiles([message.user_id]);

          if (message.user_id !== user.id) {
            void markGroupRead(group.id);
            if (nearBottom) {
              window.requestAnimationFrame(() => scrollToBottom("smooth"));
            } else {
              setShowJumpButton(true);
            }
          } else {
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
          setMessages((current) =>
            mergeMessages(current, [payload.new as ChatMessage]),
          );
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
          setMessages((current) =>
            current.filter((message) => message.id !== deletedId),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          if (!active) return;
          const row = payload.new as Reaction;
          setReactions((current) => {
            const list = current[row.message_id] ?? [];
            if (
              list.some(
                (item) => item.user_id === row.user_id && item.emoji === row.emoji,
              )
            ) {
              return current;
            }
            return { ...current, [row.message_id]: [...list, row] };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          if (!active) return;
          const row = payload.old as Reaction;
          if (!row?.message_id) return;
          setReactions((current) => {
            const list = (current[row.message_id] ?? []).filter(
              (item) => !(item.user_id === row.user_id && item.emoji === row.emoji),
            );
            return { ...current, [row.message_id]: list };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => {
          if (!active) return;
          const row = payload.new as { message_id: string; user_id: string };
          setReads((current) => {
            const list = current[row.message_id] ?? [];
            if (list.includes(row.user_id)) return current;
            return { ...current, [row.message_id]: [...list, row.user_id] };
          });
        },
      )
      .on("presence", { event: "sync" }, () => undefined);

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: user.id, online_at: new Date().toISOString() });
      }
    });

    typingChannelRef.current = channel;

    async function initialize() {
      const [profilesResult, firstPage] = await Promise.all([
        connectedClient
          .from("profiles")
          .select("id, username, display_name, avatar_url, accent, last_seen_at"),
        fetchPage(),
      ]);

      if (!active) return;

      if (profilesResult.data) {
        const map = Object.fromEntries(
          profilesResult.data.map((row) => [row.id as string, row as Profile]),
        ) as Record<string, Profile>;
        setProfiles(map);
        profilesRef.current = map;
      }

      setMessages((current) => mergeMessages(current, firstPage));
      hasMoreRef.current = firstPage.length === PAGE_SIZE;
      initialLoadCompleteRef.current = true;
      setIsInitialLoading(false);
      window.requestAnimationFrame(() => scrollToBottom());

      const ids = firstPage.map((message) => message.id);
      void loadReactions(ids);
      void loadReads(ids);

      // Tell the room we've seen everything up to now.
      const newestOther = firstPage.find((m) => m.user_id !== currentUserId);
      if (newestOther) {
        void connectedClient
          .from("message_reads")
          .upsert(
            { message_id: newestOther.id, user_id: currentUserId },
            { onConflict: "message_id,user_id", ignoreDuplicates: true },
          );
      }
    }

    void initialize();

    return () => {
      active = false;
      typingChannelRef.current = null;
      void connectedClient.removeChannel(channel);
    };
  }, [
    client,
    currentUserId,
    ensureProfiles,
    fetchPage,
    group.id,
    loadReactions,
    loadReads,
    markGroupRead,
    scrollToBottom,
    user,
  ]);

  // ------------------------------------------------------------- typing state
  const typingChannel = useMemo(() => {
    if (!client || !user) return null;
    const channel = client.channel(`typing-${group.id}`);
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const row = payload as { user_id: string; name: string };
        if (!row?.user_id || row.user_id === user.id) return;
        setTypingUsers((current) => {
          const others = current.filter((item) => item.user_id !== row.user_id);
          return [
            ...others,
            {
              user_id: row.user_id,
              display_name: row.name,
              last_seen_at: new Date().toISOString(),
            },
          ];
        });
      })
      .on("broadcast", { event: "stop_typing" }, ({ payload }) => {
        const row = payload as { user_id: string };
        setTypingUsers((current) =>
          current.filter((item) => item.user_id !== row?.user_id),
        );
      })
      .subscribe();

    return channel;
  }, [client, group.id, user]);

  useEffect(() => {
    return () => {
      if (typingChannel && client) void client.removeChannel(typingChannel);
    };
  }, [client, typingChannel]);

  // Expire stale typing indicators after 4 seconds of silence.
  useEffect(() => {
    const timer = setInterval(() => {
      setTypingUsers((current) =>
        current.filter(
          (item) => Date.now() - new Date(item.last_seen_at).getTime() < 4200,
        ),
      );
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  const broadcastTyping = useCallback(() => {
    if (!typingChannel || !user) return;
    if (Date.now() - lastTypingSentRef.current < 1600) return;
    lastTypingSentRef.current = Date.now();

    void typingChannel.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user.id, name: displayName(profile) },
    });

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      void typingChannel.send({
        type: "broadcast",
        event: "stop_typing",
        payload: { user_id: user.id },
      });
    }, 3200);
  }, [profile, typingChannel, user]);

  // ------------------------------------------------------------- pagination
  const loadOlder = useCallback(async () => {
    const element = scrollRef.current;
    const oldest = messagesRef.current[0];

    if (
      !element ||
      !oldest ||
      !initialLoadCompleteRef.current ||
      loadingOlderRef.current ||
      !hasMoreRef.current
    ) {
      return;
    }

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);

    const previousHeight = element.scrollHeight;
    const previousTop = element.scrollTop;
    const older = await fetchPage({ id: oldest.id, created_at: oldest.created_at });

    hasMoreRef.current = older.length === PAGE_SIZE;

    if (older.length > 0) {
      setMessages((current) => mergeMessages(current, older));
      const ids = older.map((message) => message.id);
      void loadReactions(ids);
      void loadReads(ids);
      void ensureProfiles(older.map((message) => message.user_id));

      window.requestAnimationFrame(() => {
        const updated = scrollRef.current;
        if (!updated) return;
        updated.scrollTop = previousTop + (updated.scrollHeight - previousHeight);
      });
    }

    loadingOlderRef.current = false;
    setIsLoadingOlder(false);
  }, [ensureProfiles, fetchPage, loadReactions, loadReads]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 140;
    setShowJumpButton(distanceFromBottom > 420);

    if (element.scrollTop < 140) void loadOlder();

    // Mark newest message read when scrolled to the bottom (throttled).
    if (distanceFromBottom < 80 && Date.now() - readMarkRef.current > 4000) {
      readMarkRef.current = Date.now();
      const newestOther = [...messagesRef.current]
        .reverse()
        .find((message) => message.user_id !== currentUserId);
      if (newestOther && client && user) {
        void client
          .from("message_reads")
          .upsert(
            { message_id: newestOther.id, user_id: currentUserId },
            { onConflict: "message_id,user_id", ignoreDuplicates: true },
          );
      }
    }
  }

  // ------------------------------------------------------------------ sending
  function handleSend(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!content.trim() || !user) return;

    const payload: OutboxPayload = {
      id: safeRandomId(),
      content: content.trim(),
      kind: "text",
      media_url: null,
      media_type: null,
      duration_seconds: null,
      reply_to_id: replyTo?.message.id ?? null,
    };

    setContent("");
    setReplyTo(null);
    setEmojiRowOpen(false);
    if (composerRef.current) composerRef.current.style.height = "auto";
    dispatchMessage(payload);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }

  async function startRecording() {
    setRecordingError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError("Voice notes aren't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void sendVoiceNote(blob);
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      vibrate(12);
      recordTimerRef.current = setInterval(
        () => setRecordSeconds((value) => value + 1),
        1000,
      );
    } catch {
      setRecordingError("Microphone permission was blocked.");
    }
  }

  function stopRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    setIsRecording(false);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
  }

  function cancelRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      chunksRef.current = [];
    }
    recorderRef.current = null;
    setIsRecording(false);
    setRecordSeconds(0);
  }

  async function sendVoiceNote(blob: Blob) {
    if (!user) return;
    const seconds = recordSeconds;
    setUploading((count) => count + 1);

    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `voice-${Date.now()}.${extension}`, {
        type: blob.type || "audio/webm",
      });
      const result = await uploadMedia(file, { groupId: group.id, userId: user.id });

      dispatchMessage({
        id: safeRandomId(),
        content: "",
        kind: "audio",
        media_url: result.url,
        media_type: result.mimeType,
        duration_seconds: Math.max(1, seconds),
        reply_to_id: null,
      });
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Couldn't send the voice note.",
      );
    } finally {
      setUploading((count) => Math.max(0, count - 1));
    }
  }

  async function handleFileSelected(
    file: File | undefined,
    input: HTMLInputElement | null,
  ) {
    input && (input.value = "");
    if (!file || !user) return;

    if (!isSupportedMedia(file)) {
      setUploadError("Only photos, videos and voice notes can be sent.");
      return;
    }

    setUploadError(null);
    setUploading((count) => count + 1);

    try {
      const result = await uploadMedia(file, { groupId: group.id, userId: user.id });

      dispatchMessage({
        id: safeRandomId(),
        content,
        kind: mediaKindFor(result.mimeType),
        media_url: result.url,
        media_type: result.mimeType,
        duration_seconds: null,
        reply_to_id: replyTo?.message.id ?? null,
      });

      setContent("");
      setReplyTo(null);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Upload failed. Try again.",
      );
    } finally {
      setUploading((count) => Math.max(0, count - 1));
    }
  }

  function sendSticker(emoji: string) {
    dispatchMessage({
      id: safeRandomId(),
      content: emoji,
      kind: "sticker",
      media_url: null,
      media_type: null,
      duration_seconds: null,
      reply_to_id: null,
    });
    if (localStorage.getItem("bitchat-sounds") !== "off") playSparkle();
  }

  function handleReactionChange(messageId: string, emoji: string, mine: boolean) {
    setReactions((current) => {
      const list = current[messageId] ?? [];
      if (mine) {
        return {
          ...current,
          [messageId]: [
            ...list,
            { message_id: messageId, user_id: currentUserId, emoji },
          ],
        };
      }
      return {
        ...current,
        [messageId]: list.filter(
          (item) => !(item.user_id === currentUserId && item.emoji === emoji),
        ),
      };
    });
  }

  function retryMessage(message: ChatMessage) {
    dispatchMessage({
      id: safeRandomId(),
      content: message.content,
      kind: message.kind,
      media_url: message.media_url,
      media_type: message.media_type,
      duration_seconds: message.duration_seconds,
      reply_to_id: message.reply_to_id,
    });
    setMessages((current) => current.filter((item) => item.id !== message.id));
  }

  // ------------------------------------------------------------------ derived
  const messageById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const message of messages) map.set(message.id, message);
    return map;
  }, [messages]);

  const directPartner = useMemo<Profile | null>(() => {
    if (!group.is_direct) return null;
    const member = Object.values(profiles).find(
      (person) => person.id !== currentUserId,
    );
    if (member) return member;
    if (group.partner) {
      return {
        id: group.partner.id,
        username: group.partner.username,
        display_name: group.partner.name,
        avatar_url: group.partner.avatar_url,
        accent: group.partner.accent,
        last_seen_at: group.partner.last_seen_at,
        couple_role: group.partner.couple_role,
        role: "user",
      };
    }
    return null;
  }, [currentUserId, group.is_direct, group.partner, profiles]);

  const otherMemberIds = useMemo(
    () =>
      Object.keys(profiles).filter((id) => id !== currentUserId),
    [currentUserId, profiles],
  );

  const onlineCount = otherMemberIds.filter((id) => onlineUserIds.has(id)).length;
  const partnerOnline = directPartner ? onlineUserIds.has(directPartner.id) : false;

  if (!client || !user) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
      {/* Header */}
      <header className="app-header glass z-20 shrink-0 border-b border-[var(--border)]/70">
        <div className="flex h-[3.75rem] items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="press -ml-1 grid size-9 shrink-0 place-items-center rounded-full text-[var(--text)]"
          >
            <ArrowLeft className="size-5" strokeWidth={2.2} />
          </button>

          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <Avatar
              name={directPartner ? displayName(directPartner) : group.name}
              seed={directPartner?.id ?? group.id}
              src={directPartner?.avatar_url}
              size={38}
              online={partnerOnline}
              ring={group.is_direct}
              accent={
                group.is_direct
                  ? "linear-gradient(140deg,#fb7185,#a855f7)"
                  : undefined
              }
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[15.5px] font-bold leading-tight tracking-tight text-[var(--text)]">
                  {group.partner?.name || (directPartner ? displayName(directPartner) : group.name)}
                </span>
                {group.is_direct && (
                  <Sparkles className="size-3 shrink-0 text-[var(--accent)]" strokeWidth={2.4} />
                )}
              </div>
              <div className="truncate text-[11.5px] font-medium leading-tight text-[var(--text-muted)]">
                {typingUsers.length > 0 ? (
                  <span className="text-[var(--accent)]">typing…</span>
                ) : group.is_direct ? (
                  partnerOnline ? (
                    <span className="text-[var(--success)]">Active now</span>
                  ) : (
                    lastSeenLabel(directPartner?.last_seen_at)
                  )
                ) : (
                  `${onlineCount} online`
                )}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="Chat info"
            className="press grid size-9 place-items-center rounded-full text-[var(--text-soft)]"
          >
            <Settings className="size-[18px]" strokeWidth={2} />
          </button>
        </div>

        {!network.online && (
          <div className="flex items-center justify-center gap-1.5 pb-1.5 text-[11px] font-semibold text-[var(--warning)]">
            <Zap className="size-3" strokeWidth={2.6} />
            Offline — messages queue and send automatically
          </div>
        )}
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-scroll thin-scrollbar relative flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-end gap-1.5 px-3 py-4 sm:px-4">
          {isLoadingOlder && (
            <div className="grid h-9 shrink-0 place-items-center">
              <Spinner className="size-4" />
            </div>
          )}

          {isInitialLoading ? (
            <div className="grid min-h-[40dvh] place-items-center">
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <div className="animate-fade-up mx-auto flex max-w-xs flex-col items-center py-10 text-center">
              <div className="grid size-16 place-items-center rounded-full accent-gradient text-white shadow-[0_16px_40px_-14px_var(--accent-glow)]">
                <Sparkles className="size-7" strokeWidth={1.8} />
              </div>
              <p className="mt-4 text-[15px] font-bold text-[var(--text)]">
                This is the beginning
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                Say hi, send a sticker, or steal a line from below.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {LOVE_PROMPTS.slice(0, 3).map((prompt: string) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setContent(prompt)}
                    className="press rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-soft)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              const previous = messages[index - 1];
              const next = messages[index + 1];
              const isOwn = message.user_id === currentUserId;
              const author = profiles[message.user_id];
              const replied = message.reply_to_id
                ? messageById.get(message.reply_to_id) ?? null
                : undefined;
              const dayChanged =
                !previous ||
                formatDayLabel(previous.created_at) !== formatDayLabel(message.created_at);

              return (
                <div key={message.id} id={`msg-${message.id}`}>
                  {dayChanged && (
                    <div className="my-3 flex items-center justify-center">
                      <span className="rounded-full bg-[var(--panel)] px-3 py-1 text-[11px] font-semibold text-[var(--text-faint)] ring-1 ring-[var(--border)]">
                        {formatDayLabel(message.created_at)}
                      </span>
                    </div>
                  )}

                  {message.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => retryMessage(message)}
                      className="mx-auto mb-2 flex items-center gap-1.5 rounded-full bg-[var(--danger)]/12 px-3 py-1 text-[11.5px] font-semibold text-[var(--danger)]"
                    >
                      Couldn&apos;t send · tap to retry
                    </button>
                  ) : null}

                  <MessageBubble
                    message={message}
                    authorName={displayName(author)}
                    replyAuthor={
                      replied ? displayName(profiles[replied.user_id]) : undefined
                    }
                    repliedMessage={replied}
                    isOwn={isOwn}
                    showAuthor={!isOwn && (!previous || previous.user_id !== message.user_id)}
                    showAvatar={!next || next.user_id !== message.user_id}
                    isRead={(reads[message.id] ?? []).some((id) => id !== currentUserId)}
                    reactions={reactions[message.id] ?? []}
                    currentUserId={currentUserId}
                    onUpdate={(id, text) =>
                      setMessages((current) =>
                        current.map((item) =>
                          item.id === id ? { ...item, content: text } : item,
                        ),
                      )
                    }
                    onDelete={(id) =>
                      setMessages((current) => current.filter((item) => item.id !== id))
                    }
                    onReply={(context) => {
                      setReplyTo(context);
                      composerRef.current?.focus();
                    }}
                    onReactionChange={handleReactionChange}
                    onScrollToMessage={(id) => {
                      const element = document.getElementById(`msg-${id}`);
                      element?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                    onOpenImage={(url, alt) => setLightbox({ url, alt })}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Jump to newest */}
      {showJumpButton && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom("smooth");
            setShowJumpButton(false);
          }}
          className="animate-fade-in absolute bottom-[7.5rem] right-4 z-20 flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--panel-2)]/95 px-3 py-2 text-[12px] font-semibold text-[var(--text)] shadow-[var(--shadow-pop)] backdrop-blur"
        >
          <ChevronRight className="size-3.5 rotate-90" strokeWidth={2.6} />
          Newest
        </button>
      )}

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="pointer-events-none absolute bottom-[4.7rem] left-3 z-10 flex items-center gap-1.5 rounded-full bg-[var(--panel)]/95 px-2.5 py-1.5 ring-1 ring-[var(--border)] backdrop-blur">
          <TypingDots />
          <span className="text-[11px] font-medium text-[var(--text-muted)]">
            {typingUsers.length === 1
              ? `${typingUsers[0].display_name.split(" ")[0]} is typing`
              : `${typingUsers.length} people typing`}
          </span>
        </div>
      )}

      {/* Composer */}
      <footer className="app-composer glass z-20 shrink-0 border-t border-[var(--border)]/70 pt-2">
        {replyTo && (
          <div className="mx-auto mb-2 flex w-full max-w-2xl items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5">
            <Reply className="size-3.5 shrink-0 text-[var(--accent)]" strokeWidth={2.4} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-[var(--accent)]">
                {replyTo.author}
              </p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">
                {replyTo.message.content || "Attachment"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid size-6 place-items-center rounded-full text-[var(--text-faint)]"
            >
              <X className="size-3.5" strokeWidth={2.6} />
            </button>
          </div>
        )}

        {(uploadError || uploading > 0) && (
          <div className="mx-auto mb-2 flex w-full max-w-2xl items-center gap-2 px-1 text-[12px]">
            {uploading > 0 ? (
              <span className="flex items-center gap-2 font-medium text-[var(--accent)]">
                <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2.4} />
                Uploading {uploading > 1 ? `${uploading} files` : "media"}…
              </span>
            ) : (
              <span className="flex items-center gap-2 text-[var(--danger)]">
                <X className="size-3.5" strokeWidth={2.6} />
                {uploadError}
                <button
                  type="button"
                  onClick={() => setUploadError(null)}
                  className="ml-auto font-semibold underline"
                >
                  dismiss
                </button>
              </span>
            )}
          </div>
        )}

        {emojiRowOpen && (
          <div className="animate-fade-up mx-auto mb-2 grid w-full max-w-2xl grid-cols-8 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2">
            {["❤️", "🥰", "😂", "😘", "🔥", "🥺", "😴", "💋", "✨", "🫶", "🎮", "☕", "🌙", "🍓", "🐱", "💌"].map(
              (emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setContent((value) => value + emoji)}
                  className="press grid aspect-square place-items-center rounded-lg text-[20px] hover:bg-[var(--panel-2)]"
                >
                  {emoji}
                </button>
              ),
            )}
          </div>
        )}

        {isRecording && (
          <div className="animate-fade-in mx-auto mb-2 flex w-full max-w-2xl items-center gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2">
            <span className="size-2.5 animate-pulse rounded-full bg-[var(--danger)]" />
            <span className="text-[12.5px] font-semibold text-[var(--danger)]">
              Recording {String(Math.floor(recordSeconds / 60)).padStart(1, "0")}:
              {String(recordSeconds % 60).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={cancelRecording}
              className="ml-auto text-[12px] font-semibold text-[var(--text-muted)] underline"
            >
              cancel
            </button>
          </div>
        )}

        {recordingError && (
          <p className="mx-auto mb-2 w-full max-w-2xl px-1 text-[12px] font-medium text-[var(--danger)]">
            {recordingError}
          </p>
        )}

        <form
          key={composerError}
          onSubmit={handleSend}
          className={`mx-auto flex w-full max-w-2xl items-end gap-1.5 ${
            composerError > 0 ? "animate-chat-shake" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => {
              primeAudio();
              setMediaPickerOpen(true);
            }}
            aria-label="Attach"
            className="press grid size-10 shrink-0 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-2)]"
          >
            <Paperclip className="size-[21px]" strokeWidth={2} />
          </button>

          <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-[22px] border border-[var(--border)] bg-[var(--panel)] px-2 py-1">
            <textarea
              ref={composerRef}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                broadcastTyping();
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 112)}px`;
              }}
              onKeyDown={handleComposerKeyDown}
              onPaste={(event) => {
                const file = event.clipboardData?.files?.[0];
                if (file) {
                  event.preventDefault();
                  void handleFileSelected(file, null);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Message…"
              aria-label="Message"
              enterKeyHint="send"
              className="my-1.5 min-h-6 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1.5 text-[15px] leading-6 text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
            <button
              type="button"
              onClick={() => setEmojiRowOpen((open) => !open)}
              aria-label="Emoji"
              className="press mb-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[var(--text-faint)] hover:text-[var(--accent)]"
            >
              <Smile className="size-[19px]" strokeWidth={1.9} />
            </button>
          </div>

          {content.trim() ? (
            <button
              type="submit"
              aria-label="Send"
              className="press grid size-11 shrink-0 place-items-center rounded-full accent-gradient text-white shadow-[0_10px_24px_-12px_var(--accent-glow)]"
            >
              <ArrowUp className="size-5" strokeWidth={2.6} />
            </button>
          ) : isRecording ? (
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Send voice note"
              className="press grid size-11 shrink-0 place-items-center rounded-full bg-[var(--danger)] text-white"
            >
              <Check className="size-5" strokeWidth={3} />
            </button>
          ) : (
            <button
              type="button"
              onPointerDown={() => void startRecording()}
              aria-label="Hold to record a voice note"
              className="press grid size-11 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] text-[var(--text-soft)]"
            >
              <Mic className="size-5" strokeWidth={2} />
            </button>
          )}
        </form>
      </footer>

      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          for (const file of files) void handleFileSelected(file, imageInputRef.current);
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => void handleFileSelected(event.target.files?.[0], videoInputRef.current)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleFileSelected(event.target.files?.[0], cameraInputRef.current)}
      />

      <MediaPicker
        open={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onPickImages={() => imageInputRef.current?.click()}
        onPickVideo={() => videoInputRef.current?.click()}
        onPickCamera={() => cameraInputRef.current?.click()}
        onPickSticker={sendSticker}
      />

      <Lightbox
        open={Boolean(lightbox)}
        url={lightbox?.url ?? ""}
        alt={lightbox?.alt ?? ""}
        onClose={() => setLightbox(null)}
      />

      <ChatInfoSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        group={groups.find((item) => item.id === group.id) ?? null}
        groupName={group.name}
        isDirect={group.is_direct}
        partner={directPartner}
        profiles={profiles}
        currentUserId={currentUserId}
        reactionsCount={Object.values(reactions).reduce(
          (sum, list) => sum + list.length,
          0,
        )}
        onBack={onBack}
      />
    </div>
  );
}
