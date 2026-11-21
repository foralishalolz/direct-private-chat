"use client";

import { Check, CheckCheck, Clock, LoaderCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { isProbablyImage } from "@/lib/media";
import { timeLabel } from "@/lib/format";
import type { ChatMessage } from "@/types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
  username: string;
  isOwn: boolean;
  canManage: boolean;
  showUsername: boolean;
  showAvatar: boolean;
  flash?: boolean;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onRetry?: (id: string) => void;
}

interface PointerOrigin {
  x: number;
  y: number;
}

export function MessageBubble({
  message,
  username,
  isOwn,
  canManage,
  showUsername,
  showAvatar,
  flash,
  onUpdate,
  onDelete,
  onRetry,
}: MessageBubbleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOrigin = useRef<PointerOrigin | null>(null);
  const longPressTriggered = useRef(false);
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [isMutating, setIsMutating] = useState(false);

  const hasMedia = Boolean(message.media_url);
  const isImage = isProbablyImage(message.media_url, message.media_type);
  const hasCaption = Boolean(message.content && message.content.trim());
  const isLoading = Boolean(message.client_pending);
  const isFailed = Boolean(message.client_failed);

  useEffect(() => {
    if (!showActions && !isEditing) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setShowActions(false);
        setIsEditing(false);
        setEditValue(message.content);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isEditing, message.content, showActions]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pointerOrigin.current = null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canManage || isEditing || isLoading || isFailed) return;

    longPressTriggered.current = false;
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowActions(true);
      longPressTimer.current = null;
      if (navigator.vibrate) navigator.vibrate(8);
    }, 480);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerOrigin.current) return;

    const distance = Math.hypot(
      event.clientX - pointerOrigin.current.x,
      event.clientY - pointerOrigin.current.y,
    );

    if (distance > 9) cancelLongPress();
  }

  function handleTap(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const wasLongPress = longPressTriggered.current;
    cancelLongPress();
    longPressTriggered.current = false;

    if (wasLongPress) return;

    if (!canManage || isEditing || target.closest("button, input, textarea")) {
      return;
    }

    setShowActions((visible) => !visible);
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
    if (!nextContent) return;

    const previousContent = message.content;
    onUpdate(message.id, nextContent);
    setIsMutating(true);

    const { error } = await supabase
      .from("messages")
      .update({ content: nextContent })
      .eq("id", message.id)
      .eq("user_id", message.user_id);

    if (error) {
      onUpdate(message.id, previousContent);
      setIsMutating(false);
      return;
    }

    setIsMutating(false);
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

    if (error) {
      setIsMutating(false);
      setShowActions(false);
      return;
    }

    onDelete(message.id);
  }

  if (!hasMedia && !hasCaption && !message.content) return null;

  const bubbleBackground = isOwn
    ? "text-white"
    : "bg-[var(--panel)] text-[var(--text)] border border-[var(--border)]";

  return (
    <div
      ref={rootRef}
      data-message-id={message.id}
      className={`relative flex w-full items-end gap-2 ${isOwn ? "justify-end" : "justify-start"}`}
    >
      {!isOwn && (
        <span
          aria-hidden="true"
          className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white ${showAvatar ? "opacity-100" : "opacity-0"}`}
          style={{ background: "var(--grad-accent)" }}
        >
          {(username || "?").charAt(0).toUpperCase()}
        </span>
      )}

      <div className="relative max-w-[82%] sm:max-w-[68%]">
        {!isOwn && showUsername && username && (
          <div className="mb-1 ml-3 text-[11px] font-semibold tracking-tight text-[var(--text-muted)]">
            {username}
          </div>
        )}

        {showActions && canManage && (
          <div
            className={`absolute -top-12 z-20 flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--panel-2)]/95 p-1 shadow-[0_10px_32px_rgba(0,0,0,0.4)] backdrop-blur ${
              isOwn ? "right-0" : "left-0"
            }`}
          >
            {!hasMedia && (
              <button
                type="button"
                onClick={beginEditing}
                aria-label="Edit"
                disabled={isMutating}
                className="grid size-9 place-items-center rounded-full text-[var(--text)] transition hover:bg-[var(--hover)] active:scale-95 disabled:opacity-40"
              >
                <Pencil aria-hidden="true" className="size-4" strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              onClick={() => void deleteMessage()}
              aria-label="Delete"
              disabled={isMutating}
              className="grid size-9 place-items-center rounded-full text-[var(--danger)] transition hover:bg-[var(--danger)]/10 active:scale-95 disabled:opacity-40"
            >
              {isMutating ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
              )}
            </button>
          </div>
        )}

        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handleTap}
          onPointerCancel={cancelLongPress}
          onContextMenu={(event) => {
            if (canManage) {
              event.preventDefault();
              setShowActions(true);
            }
          }}
          className={`animate-chat-pop overflow-hidden rounded-[22px] ${
            isOwn ? "rounded-br-[6px]" : "rounded-bl-[6px]"
          } ${bubbleBackground} ${canManage ? "cursor-pointer" : ""} ${
            flash ? "ring-2 ring-[var(--accent-text)]" : ""
          } ${isFailed ? "ring-1 ring-[var(--danger)]" : ""}`}
          style={isOwn ? { background: "var(--grad-accent)", boxShadow: "0 8px 24px rgba(193, 53, 132, 0.28)" } : undefined}
        >
          {isEditing ? (
            <form onSubmit={submitEdit} className="flex min-w-[210px] items-end gap-2 p-2 pl-3">
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
                className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-[15px] leading-5 text-inherit outline-none placeholder:text-current/60"
              />
              <button
                type="submit"
                aria-label="Save"
                disabled={isMutating || !editValue.trim()}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-white/20 text-current transition active:scale-95 disabled:opacity-40"
              >
                {isMutating ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.9} />
                ) : (
                  <Check aria-hidden="true" className="size-4" strokeWidth={2} />
                )}
              </button>
            </form>
          ) : (
            <div className="relative">
              {hasMedia && isImage && (
                <img
                  src={message.media_url!}
                  alt={message.media_name ?? "Shared image"}
                  loading="lazy"
                  className="block w-full max-h-96 rounded-[18px] object-cover"
                />
              )}
              {hasMedia && !isImage && (
                <video
                  src={message.media_url!}
                  controls
                  playsInline
                  preload="metadata"
                  className="block w-full max-h-96 rounded-[18px] object-cover"
                />
              )}
              <div className={hasMedia ? "mx-auto max-w-[420px] px-2.5 pb-2 -mt-1" : "px-4 py-2.5"}>
                {hasCaption && (
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-[20px]">{message.content}</p>
                )}
                <div className="-mb-0.5 mt-1 flex items-center justify-end gap-1.5">
                  <span className="text-[10px] font-medium leading-none opacity-70">{timeLabel(message.created_at)}</span>
                  {isLoading ? (
                    <Clock aria-hidden="true" className="size-3 animate-pulse opacity-70" strokeWidth={2} />
                  ) : isFailed ? (
                    <button
                      type="button"
                      onClick={() => onRetry?.(message.id)}
                      aria-label="Retry message"
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--danger)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--danger)]"
                    >
                      <RefreshCw aria-hidden="true" className="size-3" strokeWidth={2.2} />
                      Retry
                    </button>
                  ) : isOwn ? (
                    <CheckCheck aria-hidden="true" className="size-3.5 opacity-80" strokeWidth={2} />
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
