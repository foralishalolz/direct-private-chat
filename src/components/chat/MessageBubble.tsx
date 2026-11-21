"use client";

import {
  Check,
  LoaderCircle,
  Pencil,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { formatTime, vibrate } from "@/lib/utils";
import { DeliveryTicks } from "@/components/ui/Misc";
import { VoiceNote } from "@/components/chat/VoiceNote";
import type { ChatMessage, Reaction } from "@/types/chat";

const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🥰", "🔥", "👍", "💋"];

export interface ReplyContext {
  message: ChatMessage;
  author: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
  authorName: string;
  /** Name of whoever wrote the message this one replies to. */
  replyAuthor?: string;
  repliedMessage?: ChatMessage | null;
  isOwn: boolean;
  showAuthor: boolean;
  showAvatar: boolean;
  isRead: boolean;
  reactions: Reaction[];
  currentUserId: string;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onReply: (context: ReplyContext) => void;
  onReactionChange: (messageId: string, emoji: string, mine: boolean) => void;
  onScrollToMessage?: (id: string) => void;
  onOpenImage: (url: string, alt: string) => void;
}

interface PointerOrigin {
  x: number;
  y: number;
}

export function MessageBubble({
  message,
  authorName,
  replyAuthor,
  repliedMessage,
  isOwn,
  showAuthor,
  showAvatar,
  isRead,
  reactions,
  currentUserId,
  onUpdate,
  onDelete,
  onReply,
  onReactionChange,
  onScrollToMessage,
  onOpenImage,
}: MessageBubbleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOrigin = useRef<PointerOrigin | null>(null);
  const longPressTriggered = useRef(false);
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [isMutating, setIsMutating] = useState(false);

  const deleted = Boolean(message.deleted_at);
  const isPending = message.status === "sending";
  const isFailed = message.status === "failed";

  const groupedReactions = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const reaction of reactions) {
      const entry = map.get(reaction.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (reaction.user_id === currentUserId) entry.mine = true;
      map.set(reaction.emoji, entry);
    }
    return [...map.entries()];
  }, [reactions, currentUserId]);

  useEffect(() => {
    if (!showActions && !isEditing) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setShowActions(false);
        setShowReactions(false);
        setIsEditing(false);
        setEditValue(message.content);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isEditing, message.content, showActions]);

  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    [],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pointerOrigin.current = null;
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isEditing || deleted) return;

    longPressTriggered.current = false;
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowActions(true);
      longPressTimer.current = null;
      vibrate(10);
    }, 430);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerOrigin.current) return;
    const distance = Math.hypot(
      event.clientX - pointerOrigin.current.x,
      event.clientY - pointerOrigin.current.y,
    );
    if (distance > 10) cancelLongPress();
  }

  function handleTap(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const wasLongPress = longPressTriggered.current;
    cancelLongPress();
    longPressTriggered.current = false;

    if (wasLongPress) return;
    if (isEditing || deleted) return;
    if (target.closest("button, a, input, textarea, video, audio")) return;

    if (message.kind === "image" && message.media_url) {
      onOpenImage(message.media_url, message.content || "Photo");
      return;
    }

    setShowActions((visible) => !visible);
    setShowReactions(false);
  }

  function beginEditing() {
    setShowActions(false);
    setEditValue(message.content);
    setIsEditing(true);
    window.requestAnimationFrame(() => {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(
        editRef.current.value.length,
        editRef.current.value.length,
      );
    });
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isMutating) return;

    const nextContent = editValue.trim();
    if (!nextContent || nextContent === message.content) {
      setIsEditing(false);
      return;
    }

    const previous = message.content;
    onUpdate(message.id, nextContent);
    setIsMutating(true);

    const { error } = await supabase
      .from("messages")
      .update({ content: nextContent, edited_at: new Date().toISOString() })
      .eq("id", message.id)
      .eq("user_id", message.user_id);

    setIsMutating(false);

    if (error) {
      onUpdate(message.id, previous);
      return;
    }
    setIsEditing(false);
  }

  async function deleteMessage() {
    if (!supabase || isMutating) return;
    setIsMutating(true);
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", message.id)
      .eq("user_id", message.user_id);

    setIsMutating(false);
    if (error) return;
    onDelete(message.id);
    setShowActions(false);
  }

  async function toggleReaction(emoji: string) {
    if (!supabase) return;
    const mine = groupedReactions.find(([value]) => value === emoji)?.[1].mine;
    vibrate(6);

    // Optimistic
    onReactionChange(message.id, emoji, !mine);
    setShowReactions(false);
    setShowActions(false);

    if (mine) {
      await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", message.id)
        .eq("user_id", currentUserId)
        .eq("emoji", emoji);
    } else {
      await supabase
        .from("message_reactions")
        .insert({ message_id: message.id, user_id: currentUserId, emoji });
    }
  }

  if (deleted) {
    return (
      <div className={`flex w-full ${isOwn ? "justify-end" : "justify-start"}`}>
        <div className="rounded-[20px] border border-dashed border-[var(--border-strong)] px-3.5 py-2 text-[12.5px] italic text-[var(--text-faint)]">
          Message deleted
        </div>
      </div>
    );
  }

  const hasMedia = Boolean(message.media_url);
  const isSticker = message.kind === "sticker";
  const bubbleSurface = isSticker
    ? ""
    : isOwn
      ? "accent-gradient text-white shadow-[0_10px_24px_-16px_var(--accent-glow)]"
      : "bg-[var(--bubble-in)] text-[var(--text)] ring-1 ring-white/[0.04]";

  const hasReactions = groupedReactions.length > 0;

  return (
    <div
      ref={rootRef}
      className={`animate-chat-pop group relative flex w-full items-end gap-2 ${
        isOwn ? "justify-end" : "justify-start"
      }`}
    >
      {!isOwn && (
        <span
          className={`grid size-7 shrink-0 place-items-center self-end rounded-full text-[11px] font-bold text-white transition-opacity ${
            showAvatar ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: "linear-gradient(140deg,#fb7185,#a855f7)",
          }}
        >
          {authorName.charAt(0).toUpperCase()}
        </span>
      )}

      <div
        className={`relative max-w-[80%] sm:max-w-[70%] ${
          hasReactions ? "mb-2.5" : ""
        } ${isPending ? "opacity-70" : ""}`}
      >
        {!isOwn && showAuthor && (
          <div className="mb-1 ml-2.5 text-[11px] font-bold tracking-tight text-[var(--accent)]/80">
            {authorName}
          </div>
        )}

        {/* Action tray */}
        {showActions && (
          <div
            className={`animate-fade-in absolute -top-[3.25rem] z-30 flex items-center gap-0.5 rounded-full border border-[var(--border-strong)] bg-[var(--panel-2)]/97 p-1 shadow-[var(--shadow-pop)] backdrop-blur ${
              isOwn ? "right-0" : "left-0"
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setShowReactions((visible) => !visible);
              }}
              aria-label="React"
              className="press grid size-8 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-3)]"
            >
              <SmilePlus className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => {
                onReply({ message, author: authorName });
                setShowActions(false);
              }}
              aria-label="Reply"
              className="press grid size-8 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-3)]"
            >
              <Reply className="size-4" strokeWidth={2} />
            </button>
            {isOwn && message.kind !== "image" && message.kind !== "video" && (
              <button
                type="button"
                onClick={beginEditing}
                aria-label="Edit"
                className="press grid size-8 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-3)]"
              >
                <Pencil className="size-4" strokeWidth={2} />
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={() => void deleteMessage()}
                aria-label="Delete"
                disabled={isMutating}
                className="press grid size-8 place-items-center rounded-full text-[var(--danger)] hover:bg-[var(--danger)]/12"
              >
                {isMutating ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Trash2 className="size-4" strokeWidth={2} />
                )}
              </button>
            )}
          </div>
        )}

        {/* Quick reaction strip */}
        {showReactions && (
          <div
            className={`animate-fade-in absolute -top-[3.4rem] z-30 flex items-center gap-0.5 rounded-full border border-[var(--border-strong)] bg-[var(--panel-2)]/97 px-2 py-1.5 shadow-[var(--shadow-pop)] backdrop-blur ${
              isOwn ? "right-0" : "left-0"
            }`}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void toggleReaction(emoji)}
                className="press grid size-8 place-items-center rounded-full text-[17px] leading-none hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handleTap}
          onPointerCancel={cancelLongPress}
          onContextMenu={(event) => {
            event.preventDefault();
            setShowActions(true);
          }}
          className={`relative overflow-hidden ${isSticker ? "" : `rounded-[20px] ${isOwn ? "rounded-br-[6px]" : "rounded-bl-[6px]"} ${bubbleSurface}`}`}
        >
          {/* Reply preview */}
          {repliedMessage !== undefined && message.reply_to_id && (
            <button
              type="button"
              onClick={() => onScrollToMessage?.(message.reply_to_id as string)}
              className={`mx-2 mt-2 flex w-[calc(100%-1rem)] items-start gap-2 rounded-xl px-2.5 py-1.5 text-left ${
                isOwn ? "bg-black/18" : "bg-white/[0.05]"
              }`}
            >
              <span className="mt-0.5 h-full w-0.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <span className="min-w-0">
                <span className="block text-[11px] font-bold opacity-80">
                  {replyAuthor ?? "Replied"}
                </span>
                <span className="block truncate text-[12px] opacity-70">
                  {repliedMessage
                    ? repliedMessage.content || "Attachment"
                    : "Message unavailable"}
                </span>
              </span>
            </button>
          )}

          {isEditing ? (
            <form
              onSubmit={submitEdit}
              className="flex min-w-[220px] items-end gap-2 p-2 pl-3"
            >
              <textarea
                ref={editRef}
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setIsEditing(false);
                    setEditValue(message.content);
                  }
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={1}
                maxLength={4000}
                aria-label="Edit message"
                className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-[15px] leading-5 text-inherit outline-none"
              />
              <button
                type="submit"
                aria-label="Save"
                disabled={isMutating}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-white/20 text-current"
              >
                {isMutating ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Check className="size-4" strokeWidth={2.4} />
                )}
              </button>
            </form>
          ) : (
            <>
              {hasMedia && message.kind === "image" && (
                <button
                  type="button"
                  onClick={() => onOpenImage(message.media_url as string, message.content)}
                  className="block w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={message.media_url as string}
                    alt={message.content || "Shared photo"}
                    loading="lazy"
                    decoding="async"
                    className="max-h-[340px] w-full min-w-[180px] object-cover"
                    style={{
                      aspectRatio:
                        message.media_url && !message.content ? "4 / 3" : undefined,
                    }}
                  />
                </button>
              )}

              {hasMedia && message.kind === "video" && (
                <video
                  src={message.media_url as string}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[340px] w-full min-w-[200px] bg-black object-cover"
                />
              )}

              {hasMedia && message.kind === "audio" && (
                <VoiceNote
                  url={message.media_url as string}
                  duration={message.duration_seconds}
                  tone={isOwn ? "onAccent" : "neutral"}
                />
              )}

              {isSticker ? (
                <div className="px-1 text-[64px] leading-none">{message.content}</div>
              ) : (
                message.content && (
                  <div
                    className={`whitespace-pre-wrap break-words px-3.5 ${
                      hasMedia ? "pb-1.5 pt-2" : "py-2.5"
                    } text-[15px] leading-[21px]`}
                  >
                    {message.content}
                  </div>
                )
              )}

              <div
                className={`flex items-center justify-end gap-1 px-3 pb-1.5 ${
                  hasMedia ? "pt-0" : "pt-0"
                } ${hasMedia && message.kind !== "image" ? "bg-inherit" : ""}`}
              >
                {message.edited_at && (
                  <span className="text-[10px] opacity-60">edited</span>
                )}
                <span
                  className={`text-[10px] tabular-nums ${
                    isOwn ? "text-white/70" : "text-[var(--text-faint)]"
                  } ${hasMedia && message.kind === "image" ? "absolute bottom-2 right-2 rounded-full bg-black/45 px-1.5 py-0.5 text-white/90 backdrop-blur" : ""}`}
                >
                  {formatTime(message.created_at)}
                </span>
                {isOwn && !hasMedia && (
                  <DeliveryTicks
                    status={isFailed ? "failed" : isPending ? "sending" : "sent"}
                    read={isRead}
                  />
                )}
                {isOwn && hasMedia && (
                  <span className="text-white/90">
                    <DeliveryTicks
                      status={isFailed ? "failed" : isPending ? "sending" : "sent"}
                      read={isRead}
                    />
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Reaction pills */}
        {hasReactions && (
          <div
            className={`absolute -bottom-2.5 flex items-center gap-1 ${
              isOwn ? "right-1" : "left-1"
            }`}
          >
            {groupedReactions.slice(0, 4).map(([emoji, meta]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void toggleReaction(emoji)}
                className={`press flex items-center gap-0.5 rounded-full border px-1.5 py-[1px] text-[11px] font-bold backdrop-blur ${
                  meta.mine
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/22 text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--panel-2)]/95 text-[var(--text-soft)]"
                }`}
              >
                <span className="text-[12px] leading-none">{emoji}</span>
                {meta.count > 1 && <span>{meta.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
