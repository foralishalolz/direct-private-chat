"use client";

import { Heart, Search, Sparkles, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Misc";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/hooks/useChatStore";
import { displayName } from "@/lib/utils";
import type { Group, Profile } from "@/types/chat";

interface NewChatSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: (group: Group) => void;
}

/**
 * Starts a private 1:1 chat. Direct chats are created with a deterministic
 * name ("a :: b") so two people can never accidentally end up with two
 * duplicate threads — the API route reuses the existing one if present.
 */
export function NewChatSheet({ open, onClose, onCreated }: NewChatSheetProps) {
  const { user, groups, refreshGroups } = useChatStore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !supabase || !user) return;

    let active = true;
    setLoading(true);

    void supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, accent, last_seen_at")
      .neq("id", user.id)
      .order("username", { ascending: true })
      .then(({ data, error: profileError }) => {
        if (!active) return;
        setLoading(false);
        if (profileError) {
          setError(
            profileError.message.includes("permission")
              ? "You can only start chats with people who share a circle with you."
              : "Couldn't load people right now.",
          );
          return;
        }
        setProfiles((data ?? []) as Profile[]);
      });

    return () => {
      active = false;
    };
  }, [open, user]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return profiles;
    return profiles.filter((person) =>
      `${displayName(person)} ${person.username}`.toLowerCase().includes(term),
    );
  }, [profiles, query]);

  async function startChat(person: Profile) {
    if (!supabase || !user || creatingId) return;
    setCreatingId(person.id);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setError("Your session expired. Sign in again.");
      setCreatingId(null);
      return;
    }

    const response = await fetch("/api/direct", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: person.id }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { group?: Group; error?: string }
      | null;

    if (!response.ok || !payload?.group) {
      setError(payload?.error ?? "Couldn't start that chat.");
      setCreatingId(null);
      return;
    }

    await refreshGroups();
    setCreatingId(null);
    setQuery("");
    onCreated(payload.group);
  }

  const existingDirectIds = new Set(
    groups.filter((group) => group.is_direct).map((group) => group.id),
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Start a chat"
      description="Pick someone to open a private thread with."
    >
      <div className="space-y-3">
        <label className="flex h-11 items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5">
          <Search className="size-4 shrink-0 text-[var(--text-faint)]" strokeWidth={2.2} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </label>

        {error && (
          <p className="rounded-xl bg-[var(--danger)]/10 px-3 py-2 text-[12.5px] font-medium text-[var(--danger)]">
            {error}
          </p>
        )}

        {loading ? (
          <div className="grid place-items-center py-8">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <UserRoundPlus className="size-7 text-[var(--text-faint)]" strokeWidth={1.6} />
            <p className="mt-3 text-[13.5px] font-semibold text-[var(--text)]">
              No one to show yet
            </p>
            <p className="mt-1 max-w-[16rem] text-[12px] leading-relaxed text-[var(--text-muted)]">
              People appear here once an admin adds you both to the same circle.
            </p>
          </div>
        ) : (
          <ul className="max-h-[46dvh] space-y-1 overflow-y-auto thin-scrollbar">
            {filtered.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => void startChat(person)}
                  disabled={Boolean(creatingId)}
                  className="press flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-[var(--panel)]"
                >
                  <Avatar
                    name={displayName(person)}
                    seed={person.id}
                    src={person.avatar_url}
                    size={42}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-[var(--text)]">
                      {displayName(person)}
                    </p>
                    <p className="truncate text-[12px] text-[var(--text-muted)]">
                      @{person.username}
                    </p>
                  </div>
                  {creatingId === person.id ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Heart className="size-4 text-[var(--accent)]/60" strokeWidth={2} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-1.5 rounded-2xl bg-[var(--panel)]/60 px-3 py-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          <Sparkles className="mt-0.5 size-3 shrink-0" strokeWidth={2.2} />
          Only the two of you can read a private chat — even admins can&apos;t
          grant themselves access.{" "}
          {existingDirectIds.size > 0 && "Reopening an existing thread just revisits it."}
        </p>
      </div>
    </Sheet>
  );
}
