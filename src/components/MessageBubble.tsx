"use client";

import { Check, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import type { ChatMessage } from "@/types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
  username: string;
  isOwn: boolean;
  canManage: boolean;
  showUsername: boolean;
  showAvatar: boolean;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
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
  onUpdate,
  onDelete,
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
    if (!canManage || isEditing) return;

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

  if (!message.content) return null;

  const bubbleBackground = isOwn
    ? "bg-[var(--tg-bubble-out)] text-white"
    : "bg-[var(--tg-bubble-in)] text-[var(--tg-text)]";

  return (
    <div
      ref={rootRef}
      className={`relative flex w-full items-end gap-2 ${isOwn ? "justify-end" : "justify-start"}`}
    >
      {!isOwn && (
        <span
          aria-hidden="true"
          className={`grid size-7 shrink-0 place-items-center rounded-full bg-[var(--tg-accent)] text-[11px] font-semibold text-white ${
            showAvatar ? "opacity-100" : "opacity-0"
          }`}
        >
          {(username || "?").charAt(0).toUpperCase()}
        </span>
      )}

      <div className="relative max-w-[78%] sm:max-w-[68%]">
        {!isOwn && showUsername && username && (
          <div className="mb-1 ml-3 text-[11px] font-medium tracking-tight text-[var(--tg-text-muted)]">
            {username}
          </div>
        )}

        {showActions && canManage && (
          <div
            className={`absolute -top-12 z-20 flex items-center gap-1 rounded-full border border-[var(--tg-border)] bg-[var(--tg-panel-2)]/95 p-1 shadow-[0_10px_32px_rgba(0,0,0,0.35)] backdrop-blur ${
              isOwn ? "right-0" : "left-0"
            }`}
          >
            <button
              type="button"
              onClick={beginEditing}
              aria-label="Edit"
              disabled={isMutating}
              className="grid size-9 place-items-center rounded-full text-[var(--tg-text)] transition hover:bg-[var(--tg-hover)] active:scale-95 disabled:opacity-40"
            >
              <Pencil aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => void deleteMessage()}
              aria-label="Delete"
              disabled={isMutating}
              className="grid size-9 place-items-center rounded-full text-[var(--tg-danger)] transition hover:bg-[var(--tg-danger)]/10 active:scale-95 disabled:opacity-40"
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
          } ${bubbleBackground} ${canManage ? "cursor-pointer" : ""}`}
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
                className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-current transition active:scale-95 disabled:opacity-40"
              >
                {isMutating ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.9} />
                ) : (
                  <Check aria-hidden="true" className="size-4" strokeWidth={2} />
                )}
              </button>
            </form>
          ) : (
            <div className="whitespace-pre-wrap break-words px-4 py-2.5 text-[15px] leading-[20px]">
              {message.content}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
