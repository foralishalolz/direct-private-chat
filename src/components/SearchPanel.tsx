"use client";

import { Heart, Search, Sparkles, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/hooks/useChatStore";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Misc";
import {
  displayName,
  formatDayLabel,
  formatTime,
  previewForMessage,
} from "@/lib/utils";
import type { ChatMessage, Group, Profile } from "@/types/chat";

interface SearchPanelProps {
  onOpenGroup: (group: Group) => void;
  onOpenProfile: () => void;
}

interface MessageHit extends ChatMessage {
  group?: Group;
  authorName?: string;
}

const MIN_QUERY = 2;

export function SearchPanel({ onOpenGroup, onOpenProfile }: SearchPanelProps) {
  const { groups, profile } = useChatStore();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const requestId = useRef(0);

  const groupMap = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  // Load people once so the empty-state feels alive.
  useEffect(() => {
    if (!supabase || peopleLoaded) return;
    void supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, accent")
      .limit(30)
      .then(({ data }) => {
        setPeople((data ?? []) as Profile[]);
        setPeopleLoaded(true);
      });
  }, [peopleLoaded]);

  const runSearch = useCallback(
    async (term: string) => {
      if (!supabase || term.trim().length < MIN_QUERY || groups.length === 0) {
        setHits([]);
        setSearching(false);
        return;
      }

      const current = ++requestId.current;
      setSearching(true);

      const { data } = await supabase
        .from("messages")
        .select(
          "id, group_id, user_id, content, kind, media_url, media_type, created_at, deleted_at",
        )
        .in(
          "group_id",
          groups.map((group) => group.id),
        )
        .ilike("content", `%${term.trim()}%`)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(40);

      if (current !== requestId.current) return;

      const messages = (data ?? []) as ChatMessage[];
      const authorIds = [...new Set(messages.map((message) => message.user_id))];

      let authorMap: Record<string, string> = {};
      if (authorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, username, display_name")
          .in("id", authorIds);
        authorMap = Object.fromEntries(
          (profiles ?? []).map((row) => [
            row.id as string,
            (row.display_name as string) || (row.username as string),
          ]),
        );
      }

      if (current !== requestId.current) return;

      setHits(
        messages.map((message) => ({
          ...message,
          group: groupMap.get(message.group_id),
          authorName: authorMap[message.user_id] ?? "Someone",
        })),
      );
      setSearching(false);
    },
    [groupMap, groups],
  );

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query), 260);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return groups.filter((group) =>
      `${group.name} ${group.description ?? ""}`.toLowerCase().includes(term),
    );
  }, [groups, query]);

  const filteredPeople = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return people.filter(
      (person) =>
        person.id !== profile?.id &&
        `${displayName(person)} ${person.username}`.toLowerCase().includes(term),
    );
  }, [people, profile?.id, query]);

  const hasQuery = query.trim().length > 0;

  return (
    <main className="mx-auto w-full max-w-lg pb-[calc(var(--app-tab-height)+1rem)]">
      <header className="app-header sticky top-0 z-20 glass border-b border-[var(--border)]/60">
        <div className="flex h-[3.75rem] flex-col justify-center">
          <h1 className="text-[19px] font-extrabold tracking-tight text-[var(--text)]">
            Search
          </h1>
        </div>
        <div className="pb-3">
          <label className="flex h-11 items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5">
            <Search className="size-[18px] shrink-0 text-[var(--text-faint)]" strokeWidth={2.2} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Messages, chats, people…"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[14.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
            {hasQuery && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear"
                className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--panel-3)] text-[var(--text-muted)]"
              >
                <X className="size-3" strokeWidth={3} />
              </button>
            )}
          </label>
        </div>
      </header>

      <div className="px-3 pt-3">
        {!hasQuery ? (
          <div className="space-y-5">
            <div>
              <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                <Users className="size-3.5" strokeWidth={2.4} />
                Your people
              </p>
              <div className="thin-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {people
                  .filter((person) => person.id !== profile?.id)
                  .slice(0, 12)
                  .map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => setQuery(person.username)}
                      className="press flex w-[74px] shrink-0 flex-col items-center gap-1.5"
                    >
                      <Avatar
                        name={displayName(person)}
                        seed={person.id}
                        src={person.avatar_url}
                        accent={person.accent}
                        size={56}
                        ring
                      />
                      <span className="w-full truncate text-center text-[11px] font-semibold text-[var(--text-soft)]">
                        {displayName(person).split(" ")[0]}
                      </span>
                    </button>
                  ))}
                {people.length === 0 && (
                  <p className="px-1 py-2 text-[12.5px] text-[var(--text-faint)]">
                    People appear here once you share a circle.
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                <Sparkles className="size-3.5" strokeWidth={2.4} />
                Try
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["love", "miss you", "good night", "plan", "🎮", "photo"].map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => setQuery(term)}
                    className="press rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-soft)]"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>

            <EmptyState
              icon={<Search className="size-6" strokeWidth={1.7} />}
              title="Find anything"
              description="Every message, photo caption and chat name is searchable."
              action={
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="press rounded-full border border-[var(--border-strong)] px-4 py-2 text-[12.5px] font-semibold text-[var(--text-soft)]"
                >
                  Edit your profile
                </button>
              }
            />
          </div>
        ) : (
          <div className="space-y-5">
            {filteredGroups.length > 0 && (
              <section>
                <p className="mb-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  Chats
                </p>
                <div className="space-y-0.5">
                  {filteredGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => onOpenGroup(group)}
                      className="press flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-[var(--panel)]"
                    >
                      <Avatar
                        name={group.name}
                        seed={group.id}
                        size={40}
                        accent={group.is_direct ? "linear-gradient(140deg,#fb7185,#a855f7)" : undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-[var(--text)]">
                          {group.is_direct && (
                            <Heart className="mr-1 inline size-3 fill-[var(--accent)] text-[var(--accent)]" />
                          )}
                          {group.name}
                        </p>
                        {group.description && (
                          <p className="truncate text-[12px] text-[var(--text-muted)]">
                            {group.description}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {filteredPeople.length > 0 && (
              <section>
                <p className="mb-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  People
                </p>
                <div className="space-y-0.5">
                  {filteredPeople.map((person) => (
                    <div
                      key={person.id}
                      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2"
                    >
                      <Avatar
                        name={displayName(person)}
                        seed={person.id}
                        src={person.avatar_url}
                        accent={person.accent}
                        size={40}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-[var(--text)]">
                          {displayName(person)}
                        </p>
                        <p className="truncate text-[12px] text-[var(--text-muted)]">
                          @{person.username}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <p className="mb-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Messages
              </p>

              {searching && query.trim().length >= MIN_QUERY ? (
                <div className="grid place-items-center py-6">
                  <Spinner className="size-4" />
                </div>
              ) : hits.length === 0 ? (
                <p className="px-1 py-3 text-[13px] text-[var(--text-muted)]">
                  {query.trim().length < MIN_QUERY
                    ? `Type at least ${MIN_QUERY} characters to search messages.`
                    : "No messages match that yet."}
                </p>
              ) : (
                <div className="space-y-1">
                  {hits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => hit.group && onOpenGroup(hit.group)}
                      className="press w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-faint)]">
                        <span className="truncate">{hit.group?.name ?? "Chat"}</span>
                        <span>·</span>
                        <span className="truncate">{hit.authorName}</span>
                        <span className="ml-auto shrink-0">
                          {formatDayLabel(hit.created_at)} {formatTime(hit.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--text-soft)]">
                        {previewForMessage(hit)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
