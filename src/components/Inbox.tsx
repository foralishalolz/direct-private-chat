"use client";

import {
  Bell,
  BellOff,
  Heart,
  LogOut,
  PenSquare,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useChatStore } from "@/hooks/useChatStore";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, SectionTitle } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { NotificationBell } from "@/components/NotificationBell";
import { PushPromptCard } from "@/components/PushPromptCard";
import { displayName, previewForMessage, timeAgo } from "@/lib/utils";
import type { Group } from "@/types/chat";

interface InboxProps {
  isLoading: boolean;
  onOpenGroup: (group: Group) => void;
  onOpenProfile: () => void;
  onNewChat: () => void;
}

function GroupRow({
  group,
  unread,
  onClick,
  online,
}: {
  group: Group;
  unread: number;
  onClick: () => void;
  online: boolean;
}) {
  const preview = previewForMessage({
    content: group.last_message_preview,
    kind: group.last_message_kind,
  });
  const title = group.partner?.name || group.name;

  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex w-full items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--panel)]/60"
    >
      <Avatar
        name={title}
        seed={group.partner?.id ?? group.id}
        src={group.partner?.avatar_url}
        size={52}
        ring={unread > 0}
        online={group.is_direct && online}
        accent={
          group.partner?.accent ??
          (group.is_direct ? "linear-gradient(140deg,#fb7185,#c084fc)" : undefined)
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[15px] tracking-tight text-[var(--text)] ${
              unread > 0 ? "font-bold" : "font-semibold"
            }`}
          >
            {group.is_direct && (
              <Heart
                aria-hidden="true"
                className="mr-1.5 inline size-3.5 -translate-y-px fill-[var(--accent)] text-[var(--accent)]"
              />
            )}
            {title}
          </span>
          <span className="shrink-0 text-[11px] font-medium text-[var(--text-faint)]">
            {group.last_message_at ? timeAgo(group.last_message_at) : ""}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${
              unread > 0 ? "font-medium text-[var(--text-soft)]" : "text-[var(--text-muted)]"
            }`}
          >
            {preview || group.description || "Say something sweet…"}
          </span>
          {unread > 0 && (
            <span className="grid min-w-[20px] shrink-0 place-items-center rounded-full accent-gradient px-1.5 text-[11px] font-bold leading-5 text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function Inbox({
  isLoading,
  onOpenGroup,
  onOpenProfile,
  onNewChat,
}: InboxProps) {
  const { profile, groups, unreadByGroup, onlineUserIds, signOut } =
    useChatStore();
  const [soundsOff, setSoundsOff] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("bitchat-sounds") === "off";
  });

  const directChats = groups.filter((group) => group.is_direct);
  const circles = groups.filter((group) => !group.is_direct);
  const unreadTotal = Object.values(unreadByGroup).reduce(
    (sum, value) => sum + value,
    0,
  );

  function toggleSounds() {
    const next = !soundsOff;
    setSoundsOff(next);
    localStorage.setItem("bitchat-sounds", next ? "off" : "on");
  }

  return (
    <main className="mx-auto w-full max-w-lg pb-[calc(var(--app-tab-height)+1rem)]">
      {/* Header */}
      <header className="app-header sticky top-0 z-20 glass border-b border-[var(--border)]/60">
        <div className="flex h-[3.75rem] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label="Your profile"
              className="press"
            >
              <Avatar
                name={displayName(profile)}
                seed={profile?.id ?? "me"}
                src={profile?.avatar_url}
                size={38}
                ring
              />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-extrabold leading-tight tracking-tight text-[var(--text)]">
                BitchAt
              </h1>
              <p className="truncate text-[11.5px] font-medium leading-tight text-[var(--text-muted)]">
                {unreadTotal > 0
                  ? `${unreadTotal} new message${unreadTotal === 1 ? "" : "s"}`
                  : `Hey, ${displayName(profile).split(" ")[0]} 💫`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleSounds}
              aria-label={soundsOff ? "Turn sounds on" : "Turn sounds off"}
              className="press grid size-9 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-2)]"
            >
              {soundsOff ? (
                <BellOff className="size-[19px]" strokeWidth={1.9} />
              ) : (
                <Bell className="size-[19px]" strokeWidth={1.9} />
              )}
            </button>
            <NotificationBell />
            {profile?.role === "admin" && (
              <Link
                href="/admin"
                aria-label="Admin dashboard"
                className="press grid size-9 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-2)]"
              >
                <Settings className="size-[19px]" strokeWidth={1.9} />
              </Link>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="press grid size-9 place-items-center rounded-full text-[var(--text-soft)] hover:bg-[var(--panel-2)]"
            >
              <LogOut className="size-[18px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </header>

      <div className="px-3 pt-3">
        <PushPromptCard />

        {isLoading ? (
          <div className="space-y-3 px-1 pt-2">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3.5">
                <div className="skeleton size-[52px] rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-2/5 rounded-full" />
                  <div className="skeleton h-3 w-3/4 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-6" strokeWidth={1.7} />}
            title="Nothing here yet"
            description="Start a private chat with someone, or ask your admin to add you to a circle."
            action={
              <Button onClick={onNewChat} size="sm" icon={<PenSquare className="size-4" />}>
                Start a chat
              </Button>
            }
          />
        ) : (
          <div className="space-y-6 pt-1">
            <button
              type="button"
              onClick={onNewChat}
              className="press flex w-full items-center gap-3.5 rounded-2xl border border-dashed border-[var(--border-strong)] px-3 py-3 text-left"
            >
              <span className="grid size-[52px] shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                <PenSquare className="size-5" strokeWidth={2} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold text-[var(--text)]">
                  Start something new
                </span>
                <span className="block text-[13px] text-[var(--text-muted)]">
                  A private chat, or tell your admin about a circle
                </span>
              </span>
            </button>

            {directChats.length > 0 && (
              <section>
                <SectionTitle>
                  <span className="inline-flex items-center gap-1.5">
                    <Heart className="size-3 fill-[var(--accent)] text-[var(--accent)]" />
                    Just us
                  </span>
                </SectionTitle>
                <div className="space-y-0.5">
                  {directChats.map((group) => (
                    <GroupRow
                      key={group.id}
                      group={group}
                      unread={unreadByGroup[group.id] ?? 0}
                      onClick={() => onOpenGroup(group)}
                      online={Boolean(group.partner && onlineUserIds.has(group.partner.id))}
                    />
                  ))}
                </div>
              </section>
            )}

            {circles.length > 0 && (
              <section>
                <SectionTitle>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5" strokeWidth={2.2} />
                    Circles
                  </span>
                </SectionTitle>
                <div className="space-y-0.5">
                  {circles.map((group) => (
                    <GroupRow
                      key={group.id}
                      group={group}
                      unread={unreadByGroup[group.id] ?? 0}
                      onClick={() => onOpenGroup(group)}
                      online={Boolean(group.partner && onlineUserIds.has(group.partner.id))}
                    />
                  ))}
                </div>
              </section>
            )}

            <p className="flex items-center justify-center gap-1.5 pb-2 pt-2 text-[11px] text-[var(--text-faint)]">
              <Heart className="size-3" strokeWidth={2} />
              {[...onlineUserIds].length > 0
                ? `${[...onlineUserIds].length} online right now`
                : `${groups.length} chat${groups.length === 1 ? "" : "s"} · end-to-end private`}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
