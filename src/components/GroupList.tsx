"use client";

import { LogOut, MessagesSquare, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Group, Profile } from "@/types/chat";

interface GroupListProps {
  profile: Profile | null;
  fallbackUsername: string;
  groups: Group[];
  isLoading: boolean;
  onSelect: (group: Group) => void;
  onSignOut: () => void;
}

export function GroupList({
  profile,
  fallbackUsername,
  groups,
  isLoading,
  onSelect,
  onSignOut,
}: GroupListProps) {
  const displayName = profile?.username ?? fallbackUsername;
  const isAdmin = profile?.role === "admin";

  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--tg-bg)]">
      <header className="safe-header fixed inset-x-0 top-0 z-30 border-b border-[var(--tg-border)] bg-[var(--tg-panel)]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--tg-accent)] text-[15px] font-semibold text-white"
            >
              {displayName.charAt(0).toUpperCase() || "•"}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-tight text-[var(--tg-text)]">
                {displayName}
              </div>
              <div className="truncate text-[11px] leading-tight text-[var(--tg-text-muted)]">
                {isAdmin ? "Admin" : "Member"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {isAdmin && (
              <Link
                href="/admin"
                aria-label="Admin dashboard"
                className="grid size-10 place-items-center rounded-full text-[var(--tg-text)] transition hover:bg-[var(--tg-hover)] active:scale-95"
              >
                <ShieldCheck aria-hidden="true" className="size-5" strokeWidth={1.7} />
              </Link>
            )}
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="grid size-10 place-items-center rounded-full text-[var(--tg-text)] transition hover:bg-[var(--tg-hover)] active:scale-95"
            >
              <LogOut aria-hidden="true" className="size-[19px]" strokeWidth={1.7} />
            </button>
          </div>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 top-[var(--chat-header-height)] overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-3 py-2 sm:px-5">
          {isLoading ? (
            <div className="grid min-h-[40dvh] place-items-center text-sm text-[var(--tg-text-muted)]">
              Loading your groups…
            </div>
          ) : groups.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-2 px-6 text-center">
              <MessagesSquare
                aria-hidden="true"
                className="size-8 text-[var(--tg-text-muted)]"
                strokeWidth={1.5}
              />
              <p className="text-[15px] font-medium text-[var(--tg-text)]">
                No groups yet
              </p>
              <p className="text-sm text-[var(--tg-text-muted)]">
                {isAdmin
                  ? "Create a group from the admin dashboard to get started."
                  : "Ask the admin to add you to a group."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--tg-border)]">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(group)}
                    className="flex w-full items-center gap-3 py-3 text-left transition active:bg-[var(--tg-hover)]"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--tg-accent)] text-base font-semibold text-white"
                    >
                      {group.name.charAt(0).toUpperCase() || "#"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium text-[var(--tg-text)]">
                        {group.name}
                      </div>
                      {group.description && (
                        <div className="truncate text-[13px] text-[var(--tg-text-muted)]">
                          {group.description}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
