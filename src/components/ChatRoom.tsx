"use client";

import { ArrowLeft, LoaderCircle, Send } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageBubble } from "@/components/MessageBubble";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Group, MessageCursor, Profile } from "@/types/chat";

const PAGE_SIZE = 30;

interface ChatRoomProps {
  user: User;
  currentProfile: Profile | null;
  group: Group;
  onBack: () => void;
}

function compareMessages(left: ChatMessage, right: ChatMessage) {
  const timeDifference =
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime();

  if (timeDifference !== 0) return timeDifference;
  return left.id.localeCompare(right.id);
}

function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(compareMessages);
}

export function ChatRoom({ user, currentProfile, group, onBack }: ChatRoomProps) {
  const client = supabase;
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const profilesRef = useRef<Record<string, string>>({});
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(true);
  const initialLoadCompleteRef = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [composerError, setComposerError] = useState(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    const footer = footerRef.current;
    const scrollElement = scrollRef.current;
    if (!footer || !scrollElement) return;

    function updateScrollInset() {
      if (!footer || !scrollElement) return;

      const distanceFromBottom =
        scrollElement.scrollHeight -
        scrollElement.scrollTop -
        scrollElement.clientHeight;

      scrollElement.style.bottom = `${footer.getBoundingClientRect().height}px`;

      if (distanceFromBottom < 80) {
        window.requestAnimationFrame(() => {
          scrollElement.scrollTop = scrollElement.scrollHeight;
        });
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
        .select("id, group_id, user_id, content, created_at")
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
          const element = scrollRef.current;
          const isNearBottom = element
            ? element.scrollHeight - element.scrollTop - element.clientHeight < 160
            : true;

          setMessages((current) => mergeMessages(current, [message]));
          void ensureProfile(message.user_id);

          if (isNearBottom || message.user_id === user.id) {
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
      .subscribe();

    async function initialize() {
      const [profilesResult, firstPage] = await Promise.all([
        connectedClient.from("profiles").select("id, username"),
        fetchPage(),
      ]);

      if (!active) return;

      if (profilesResult.data) {
        const profileMap = Object.fromEntries(
          profilesResult.data.map((profile) => [
            profile.id as string,
            profile.username as string,
          ]),
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
  }, [client, ensureProfile, fetchPage, group.id, scrollToBottom, user.id]);

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

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!client || isSending) return;

    const nextContent = content.trim();
    if (!nextContent) return;

    setIsSending(true);

    const messageId = crypto.randomUUID();

    const optimisticMessage: ChatMessage = {
      id: messageId,
      group_id: group.id,
      user_id: user.id,
      content: nextContent,
      created_at: new Date().toISOString(),
    };

    setMessages((current) => mergeMessages(current, [optimisticMessage]));
    setContent("");
    resetComposerHeight();
    window.requestAnimationFrame(() => scrollToBottom("smooth"));

    const { data, error } = await client
      .from("messages")
      .insert({
        id: messageId,
        group_id: group.id,
        user_id: user.id,
        content: nextContent,
      })
      .select("id, group_id, user_id, content, created_at")
      .single();

    if (error || !data) {
      const persistenceCheck = await client
        .from("messages")
        .select("id, group_id, user_id, content, created_at")
        .eq("id", messageId)
        .maybeSingle();

      if (persistenceCheck.data) {
        setMessages((current) =>
          mergeMessages(current, [persistenceCheck.data as ChatMessage]),
        );
        setIsSending(false);
        return;
      }

      setMessages((current) =>
        current.filter((message) => message.id !== messageId),
      );
      setContent(nextContent);
      setComposerError((attempt) => attempt + 1);
      setIsSending(false);
      return;
    }

    setMessages((current) => mergeMessages(current, [data as ChatMessage]));
    setIsSending(false);
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
    setMessages((current) =>
      current.filter((message) => message.id !== id),
    );
  }

  const fallbackUsername = useMemo(
    () => user.email?.split("@")[0] ?? "",
    [user.email],
  );

  if (!client) return null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--tg-bg)]">
      <header className="safe-header fixed inset-x-0 top-0 z-30 border-b border-[var(--tg-border)] bg-[var(--tg-panel)]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to groups"
            className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--tg-text)] transition hover:bg-[var(--tg-hover)] active:scale-95"
          >
            <ArrowLeft aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </button>

          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--tg-accent)] text-[15px] font-semibold text-white"
            >
              {group.name.charAt(0).toUpperCase() || "#"}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-tight text-[var(--tg-text)]">
                {group.name}
              </div>
              <div className="truncate text-[11px] leading-tight text-[var(--tg-text-muted)]">
                {currentProfile?.username ?? fallbackUsername}
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
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin text-[var(--tg-text-muted)]"
                strokeWidth={1.6}
              />
            </div>
          )}

          {isInitialLoading ? (
            <div className="grid min-h-[40dvh] place-items-center">
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin text-[var(--tg-text-muted)]"
                strokeWidth={1.6}
              />
            </div>
          ) : (
            messages.map((message, index) => {
              const previousMessage = messages[index - 1];
              const nextMessage = messages[index + 1];
              const isOwn = message.user_id === user.id;

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  username={
                    profiles[message.user_id] ??
                    (isOwn ? currentProfile?.username ?? fallbackUsername : "")
                  }
                  isOwn={isOwn}
                  canManage={isOwn}
                  showUsername={
                    !previousMessage || previousMessage.user_id !== message.user_id
                  }
                  showAvatar={
                    !nextMessage || nextMessage.user_id !== message.user_id
                  }
                  onUpdate={handleOptimisticUpdate}
                  onDelete={handleOptimisticDelete}
                />
              );
            })
          )}
        </div>
      </div>

      <footer
        ref={footerRef}
        className="safe-composer fixed inset-x-0 bottom-0 z-30 border-t border-[var(--tg-border)] bg-[var(--tg-panel)]/95 pt-3 backdrop-blur-xl"
      >
        <form
          key={composerError}
          onSubmit={handleSend}
          className={`mx-auto flex w-full max-w-3xl items-end gap-2 ${
            composerError > 0 ? "animate-chat-shake" : ""
          }`}
        >
          <div className="flex min-h-12 min-w-0 flex-1 items-end rounded-[22px] border border-[var(--tg-border)] bg-[var(--tg-panel-2)] px-3 py-1.5">
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
              readOnly={isSending}
              placeholder="Message"
              aria-label="Message"
              enterKeyHint="send"
              className="my-2 min-h-6 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 text-[15px] leading-6 text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-muted)]"
            />
          </div>

          <button
            type="submit"
            disabled={isSending || !content.trim()}
            aria-label="Send"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--tg-accent)] text-white transition hover:bg-[var(--tg-accent-strong)] active:scale-95 disabled:bg-[var(--tg-panel-2)] disabled:text-[var(--tg-text-muted)]"
          >
            {isSending ? (
              <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={1.8} />
            ) : (
              <Send aria-hidden="true" className="size-[19px] -translate-x-px" strokeWidth={1.8} />
            )}
          </button>
        </form>
      </footer>
    </main>
  );
}
