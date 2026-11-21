"use client";

import { MessagesSquare, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { GroupAvatar } from "@/components/Avatar";
import { supabase } from "@/lib/supabase";
import type { Group, Profile } from "@/types/chat";

export function lastReadKey(groupId: string) {
  return `direct-last-read:${groupId}`;
}

export function markGroupRead(groupId: string) {
  try {
    window.localStorage.setItem(lastReadKey(groupId), new Date().toISOString());
  } catch {
    /* best effort */
  }
}

interface Preview {
  content: string;
  created_at: string;
  media_type: string | null;
}

interface GroupListProps {
  profile: Profile | null;
  fallbackUsername: string;
  groups: Group[];
  isLoading: boolean;
  onSelect: (group: Group) => void;
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function GroupList({
  profile,
  fallbackUsername,
  groups,
  isLoading,
  onSelect,
}: GroupListProps) {
  const displayName = profile?.username ?? fallbackUsername;
  const isAdmin = profile?.role === "admin";
  const [previews, setPreviews] = useState<Record<string, Preview | null>>({});
  const [hasUnread, setHasUnread] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;

    (async () => {
      if (!supabase || groups.length === 0) {
        if (active) {
          setPreviews({});
          setHasUnread({});
        }
        return;
      }

      const entries = await Promise.all(
        groups.map(async (group) => {
          const { data } = await supabase!
            .from("messages")
            .select("id, content, created_at, media_type")
            .eq("group_id", group.id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1);
          const row = data?.[0] ?? null;
          if (!row) return { id: group.id, preview: null as Preview | null, unread: false };
          const preview: Preview = {
            content: (row.content ?? "") as string,
            created_at: row.created_at as string,
            media_type: (row.media_type as string | null) ?? null,
          };
          const lastRead = window.localStorage.getItem(lastReadKey(group.id));
          const unread = !lastRead || new Date(preview.created_at).getTime() > new Date(lastRead).getTime();
          return { id: group.id, preview, unread };
        }),
      );

      if (!active) return;

      const nextPreviews: Record<string, Preview | null> = {};
      const nextUnread: Record<string, boolean> = {};
      for (const { id, preview, unread } of entries) {
        nextPreviews[id] = preview;
        nextUnread[id] = unread;
      }
      setPreviews(nextPreviews);
      setHasUnread(nextUnread);
    })();

    return () => {
      active = false;
    };
  }, [groups]);

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-2 px-3 py-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl p-2.5">
              <div className="skeleton size-12 shrink-0 rounded-2xl" />
              <div className="flex-1 space-y-2 py-1">
                <div className="skeleton h-3.5 w-32 rounded" />
                <div className="skeleton h-3 w-48 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <span
            aria-hidden="true"
            className="grid size-16 place-items-center rounded-3xl text-white"
            style={{ background: "var(--grad-accent)" }}
          >
            <MessagesSquare aria-hidden="true" className="size-7" strokeWidth={1.6} />
          </span>
          <p className="text-[15px] font-semibold">No groups yet</p>
          <p className="max-w-[26ch] text-sm text-[var(--text-muted)]">
            {isAdmin
              ? "Create a group from the admin dashboard to get started."
              : "Ask the admin to add you to a group."}
          </p>
          {isAdmin && (
            <a
              href="/admin"
              className="btn-accent mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
            >
              <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={2} />
              Open admin
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-4">
        <div className="px-2 pb-2 pt-1">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white"
              style={{ background: "var(--grad-accent)" }}
            >
              {displayName.charAt(0).toUpperCase() || "•"}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-tight">{displayName}</div>
              <div className="truncate text-[11px] leading-tight text-[var(--text-muted)]">
                {isAdmin ? "You are admin" : "Member"}
              </div>
            </div>
          </div>
        </div>

        <ul className="space-y-1">
          {groups.map((group) => {
            const preview = previews[group.id];
            const unread = hasUnread[group.id];
            const previewText = preview
              ? preview.media_type
                ? `${preview.media_type === "video" ? "🎥 Video" : "🖼️ Photo"}${preview.content ? ` · ${preview.content}` : ""}`
                : preview.content
              : "No messages yet";
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => onSelect(group)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-[var(--hover)] active:scale-[0.99]"
                >
                  <GroupAvatar seed={group.id} name={group.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] font-medium">{group.name}</span>
                      {preview && (
                        <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                          {timeAgo(preview.created_at)}
                        </span>
                      )}
                    </div>
                    <p
                      className={`truncate text-[13px] ${
                        unread ? "font-medium text-[var(--text)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {previewText}
                    </p>
                  </div>
                  {unread && (
                    <span
                      aria-label="Unread messages"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: "var(--grad-accent)" }}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
