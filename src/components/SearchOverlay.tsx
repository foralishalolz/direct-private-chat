"use client";

import { Heart, Search, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { GroupAvatar } from "@/components/Avatar";
import { supabase } from "@/lib/supabase";
import type { Group } from "@/types/chat";

interface SearchOverlayProps {
  user: User;
  groups: Group[];
  onClose: () => void;
  onJumpToMessage: (group: Group, messageId: string) => void;
  onOpenCouples: () => void;
}

interface SearchResult {
  kind: "group" | "message" | "couple";
  id: string;
  groupId?: string;
  title: string;
  subtitle: string;
  time?: string;
}

export function SearchOverlay({
  user,
  groups,
  onClose,
  onJumpToMessage,
  onOpenCouples,
}: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const groupNameById = useMemo(
    () => new Map(groups.map((g) => [g.id, g.name])),
    [groups],
  );

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const trimmed = query.trim();

    timeoutRef.current = setTimeout(async () => {
      if (trimmed.length < 2) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);

      if (!supabase) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      const requestId = ++requestIdRef.current;
      const groupIds = groups.map((g) => g.id);
      const lower = trimmed.toLowerCase();

      const found: SearchResult[] = [];

      // Groups
      for (const group of groups) {
        if (group.name.toLowerCase().includes(lower)) {
          found.push({ kind: "group", id: group.id, title: group.name, subtitle: "Group" });
        }
      }

      // Messages across my groups
      if (groupIds.length > 0) {
        const { data: messages } = await supabase
          .from("messages")
          .select("id, group_id, content, media_name, created_at")
          .in("group_id", groupIds)
          .or(`content.ilike.%${trimmed.replace(/[%,().]/g, "")}%,media_name.ilike.%${trimmed.replace(/[%,().]/g, "")}%`)
          .order("created_at", { ascending: false })
          .limit(12);

        for (const row of (messages ?? []) as { id: string; group_id: string; content: string | null; media_name: string | null; created_at: string }[]) {
          const preview = row.content?.trim() || row.media_name || "Media";
          found.push({
            kind: "message",
            id: row.id,
            groupId: row.group_id,
            title: groupNameById.get(row.group_id) ?? "Chat",
            subtitle: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
            time: new Date(row.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
        }
      }

      // Couples
      const { data: memberships } = await supabase
        .from("couple_members")
        .select("couple_id")
        .eq("user_id", user.id);

      const coupleIds = (memberships ?? []).map((m) => m.couple_id as string);
      if (coupleIds.length > 0) {
        const { data: couples } = await supabase
          .from("couples")
          .select("id, name")
          .in("id", coupleIds)
          .ilike("name", `%${trimmed.replace(/[%,().]/g, "")}%`)
          .limit(5);

        for (const couple of (couples ?? []) as { id: string; name: string | null }[]) {
          found.push({
            kind: "couple",
            id: couple.id,
            title: couple.name || "Couple",
            subtitle: "Couple space",
          });
        }
      }

      if (requestId === requestIdRef.current) {
        setResults(found);
        setIsSearching(false);
      }
    }, 220);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, groups, user.id]);

  function handleSelect(result: SearchResult) {
    if (result.kind === "couple") {
      onOpenCouples();
      return;
    }
    const group = groups.find((g) => g.id === (result.kind === "group" ? result.id : result.groupId));
    if (!group) return;
    onJumpToMessage(group, result.kind === "message" ? result.id : "");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="glass flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[var(--border-strong)] shadow-[0_32px_80px_rgba(0,0,0,0.55)] sm:rounded-3xl">
        <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--text-muted)]"
          >
            <Search aria-hidden="true" className="size-4" strokeWidth={2} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats, messages, couples…"
            aria-label="Search"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {query.trim().length < 2 && (
            <div className="p-2">
              <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                Quick
              </p>
              <ul className="space-y-0.5">
                {groups.map((group) => (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect({ kind: "group", id: group.id, title: group.name, subtitle: "Group" })}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--hover)]"
                    >
                      <GroupAvatar seed={group.id} name={group.name} className="size-10" />
                      <span className="truncate text-[14px] font-medium">{group.name}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={onOpenCouples}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--hover)]"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-2xl text-white"
                      style={{ background: "var(--grad-accent)" }}
                    >
                      <Heart aria-hidden="true" className="size-4" strokeWidth={2} />
                    </span>
                    <span className="text-[14px] font-medium">Couples & plans</span>
                  </button>
                </li>
              </ul>
            </div>
          )}

          {query.trim().length >= 2 && isSearching && (
            <div className="grid place-items-center p-10">
              <span className="size-5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-text)]" />
            </div>
          )}

          {query.trim().length >= 2 && !isSearching && results.length === 0 && (
            <div className="p-10 text-center">
              <p className="text-[14px] font-medium text-[var(--text-muted)]">No results for “{query.trim()}”</p>
            </div>
          )}

          {results.length > 0 && (
            <ul className="space-y-0.5">
              {results.map((result) => (
                <li key={`${result.kind}-${result.id}`}>
                  <button
                    type="button"
                    onClick={() => handleSelect(result)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--hover)]"
                  >
                    {result.kind === "group" ? (
                      <GroupAvatar seed={result.id} name={result.title} className="size-10" />
                    ) : result.kind === "couple" ? (
                      <span
                        aria-hidden="true"
                        className="grid size-10 shrink-0 place-items-center rounded-2xl text-white"
                        style={{ background: "var(--grad-accent)" }}
                      >
                        <Heart aria-hidden="true" className="size-4" strokeWidth={2} />
                      </span>
                    ) : (
                      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--panel-2)] text-[var(--text-muted)]">
                        <Search aria-hidden="true" className="size-4" strokeWidth={2} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{result.title}</span>
                      <span className="block truncate text-[12px] text-[var(--text-muted)]">{result.subtitle}</span>
                    </span>
                    {result.time && (
                      <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{result.time}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
