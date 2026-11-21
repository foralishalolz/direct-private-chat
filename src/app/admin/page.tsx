"use client";

import {
  ArrowLeft,
  Crown,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill, SectionTitle } from "@/components/ui/Misc";
import { timeAgo } from "@/lib/utils";
import type { Group, UserRole } from "@/types/chat";

interface AdminUser {
  id: string;
  username: string;
  role: UserRole;
  created_at: string;
  groupIds: string[];
}

async function authorizedFetch(input: string, init: RequestInit = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  headers.set("Content-Type", "application/json");

  return fetch(input, { ...init, headers });
}

export default function AdminPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [pendingGroupIds, setPendingGroupIds] = useState<string[]>([]);
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoadingData(true);
    setLoadError(null);

    try {
      const [groupsRes, usersRes] = await Promise.all([
        authorizedFetch("/api/admin/groups"),
        authorizedFetch("/api/admin/users"),
      ]);

      if (!groupsRes.ok || !usersRes.ok) {
        setLoadError("Could not load admin data.");
        setIsLoadingData(false);
        return;
      }

      const groupsJson = (await groupsRes.json()) as { groups: Group[] };
      const usersJson = (await usersRes.json()) as { users: AdminUser[] };

      setGroups(groupsJson.groups);
      setUsers(usersJson.users);
    } catch {
      setLoadError("Could not load admin data.");
    }

    setIsLoadingData(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      router.replace("/login");
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;

      const sessionUser = data.session?.user ?? null;
      if (!sessionUser) {
        router.replace("/login");
        return;
      }

      const { data: profile } = await supabase!
        .from("profiles")
        .select("role")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (!active) return;

      if (!profile || profile.role !== "admin") {
        router.replace("/");
        return;
      }

      setIsAuthorized(true);
      setIsChecking(false);
      void loadData();
    });

    return () => {
      active = false;
    };
  }, [router, loadData]);

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingGroup) return;

    const name = newGroupName.trim();
    if (!name) return;

    setIsCreatingGroup(true);
    setCreateError(null);

    const response = await authorizedFetch("/api/admin/groups", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: newGroupDescription.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setCreateError(body?.error ?? "Could not create the group.");
      setIsCreatingGroup(false);
      return;
    }

    setNewGroupName("");
    setNewGroupDescription("");
    setIsCreatingGroup(false);
    void loadData();
  }

  async function handleDeleteGroup(groupId: string) {
    if (!confirm("Delete this circle and every message in it? This can't be undone.")) {
      return;
    }

    setDeletingGroupId(groupId);
    const response = await authorizedFetch(`/api/admin/groups/${groupId}`, {
      method: "DELETE",
    });
    setDeletingGroupId(null);

    if (response.ok) void loadData();
  }

  function openAccessMenu(user: AdminUser) {
    setOpenUserId((current) => (current === user.id ? null : user.id));
    setPendingGroupIds(user.groupIds);
  }

  function toggleGroupForPendingUser(groupId: string) {
    setPendingGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  }

  async function handleSaveAccess(userId: string) {
    setIsSavingAccess(true);

    const response = await authorizedFetch(`/api/admin/users/${userId}/groups`, {
      method: "PUT",
      body: JSON.stringify({ groupIds: pendingGroupIds }),
    });

    setIsSavingAccess(false);

    if (response.ok) {
      setOpenUserId(null);
      void loadData();
    }
  }

  if (isChecking || !isAuthorized) {
    return (
      <main className="hero-bg grid min-h-dvh w-full place-items-center">
        <LoaderCircle
          className="size-5 animate-spin text-[var(--text-muted)]"
          strokeWidth={1.8}
        />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[var(--bg)] pb-20">
      <header className="app-header glass sticky top-0 z-20 border-b border-[var(--border)]">
        <div className="mx-auto flex h-[3.75rem] w-full max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              aria-label="Back to chat"
              className="press grid size-9 place-items-center rounded-full text-[var(--text)] hover:bg-[var(--panel-2)]"
            >
              <ArrowLeft className="size-5" strokeWidth={2.2} />
            </Link>
            <div>
              <h1 className="flex items-center gap-1.5 text-[16px] font-extrabold tracking-tight text-[var(--text)]">
                <ShieldCheck className="size-4 text-[var(--accent)]" strokeWidth={2.4} />
                Admin
              </h1>
              <p className="text-[11px] font-medium text-[var(--text-muted)]">
                Circles & access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Pill tone="accent">
              <Crown className="size-2.5" strokeWidth={2.6} />
              god mode
            </Pill>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-5 px-3 py-5">
        {loadError && (
          <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-[13px] text-[var(--danger)]">
            {loadError}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Circles", value: groups.length, icon: Users },
            { label: "People", value: users.length, icon: Sparkles },
            {
              label: "Admins",
              value: users.filter((user) => user.role === "admin").length,
              icon: Crown,
            },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3"
            >
              <Icon className="size-4 text-[var(--accent)]" strokeWidth={2.2} />
              <p className="mt-1.5 text-[19px] font-extrabold leading-none text-[var(--text)]">
                {value}
              </p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* Create group */}
        <section className="card p-4">
          <SectionTitle>Create a circle</SectionTitle>
          <p className="-mt-1 mb-3 px-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
            Only you can create circles. Add members below once it exists.
          </p>

          <form onSubmit={handleCreateGroup} className="space-y-2.5">
            <Input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Circle name (e.g. Our gang, Study crew)"
              maxLength={60}
              aria-label="Circle name"
            />
            <Input
              value={newGroupDescription}
              onChange={(event) => setNewGroupDescription(event.target.value)}
              placeholder="Description (optional)"
              maxLength={200}
              aria-label="Circle description"
            />

            {createError && (
              <p className="text-[12.5px] font-medium text-[var(--danger)]">
                {createError}
              </p>
            )}

            <Button
              type="submit"
              loading={isCreatingGroup}
              disabled={!newGroupName.trim()}
              icon={<Plus className="size-4" strokeWidth={2.6} />}
            >
              Create circle
            </Button>
          </form>
        </section>

        {/* Groups */}
        <section>
          <SectionTitle>Circles</SectionTitle>

          {isLoadingData ? (
            <div className="grid place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-8">
              <LoaderCircle className="size-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.8} />
            </div>
          ) : groups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
              No circles yet. Create your first one above.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
              {groups.map((group) => {
                const memberCount = users.filter((user) =>
                  user.groupIds.includes(group.id),
                ).length;

                return (
                  <li key={group.id} className="flex items-center gap-3 px-3.5 py-3">
                    <Avatar name={group.name} seed={group.id} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-[var(--text)]">
                        {group.name}
                      </div>
                      <div className="truncate text-[11.5px] text-[var(--text-muted)]">
                        {memberCount} member{memberCount === 1 ? "" : "s"}
                        {group.description ? ` · ${group.description}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGroup(group.id)}
                      disabled={deletingGroupId === group.id}
                      aria-label={`Delete ${group.name}`}
                      className="press grid size-8 shrink-0 place-items-center rounded-full text-[var(--text-faint)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                    >
                      {deletingGroupId === group.id ? (
                        <LoaderCircle className="size-4 animate-spin" strokeWidth={2} />
                      ) : (
                        <Trash2 className="size-4" strokeWidth={2} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Users */}
        <section>
          <SectionTitle>People & access</SectionTitle>

          {isLoadingData ? (
            <div className="grid place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-8">
              <LoaderCircle className="size-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.8} />
            </div>
          ) : users.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
              No accounts yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={user.username} seed={user.id} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-semibold text-[var(--text)]">
                          {user.username}
                        </span>
                        {user.role === "admin" && (
                          <Pill tone="accent">
                            <Crown className="size-2.5" strokeWidth={2.6} />
                            admin
                          </Pill>
                        )}
                      </div>
                      <div className="truncate text-[11.5px] text-[var(--text-muted)]">
                        {user.groupIds.length} circle
                        {user.groupIds.length === 1 ? "" : "s"} · joined{" "}
                        {timeAgo(user.created_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAccessMenu(user)}
                      className="press shrink-0 rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-soft)]"
                    >
                      {openUserId === user.id ? "Close" : "Access"}
                    </button>
                  </div>

                  {openUserId === user.id && (
                    <div className="animate-fade-up mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                      {groups.length === 0 ? (
                        <p className="text-[12.5px] text-[var(--text-muted)]">
                          Create a circle first.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {groups.map((group) => {
                            const checked = pendingGroupIds.includes(group.id);
                            return (
                              <button
                                key={group.id}
                                type="button"
                                onClick={() => toggleGroupForPendingUser(group.id)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left"
                              >
                                <span
                                  className={`grid size-[18px] shrink-0 place-items-center rounded-[6px] border transition ${
                                    checked
                                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                                      : "border-[var(--border-strong)] bg-transparent"
                                  }`}
                                >
                                  {checked && (
                                    <svg viewBox="0 0 12 12" className="size-3" fill="none">
                                      <path
                                        d="M2.5 6.2 4.8 8.5 9.5 3.8"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                </span>
                                <span className="text-[13.5px] text-[var(--text)]">
                                  {group.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="sm"
                          loading={isSavingAccess}
                          onClick={() => void handleSaveAccess(user.id)}
                        >
                          Save access
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenUserId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-2 pb-4 text-center text-[11px] leading-relaxed text-[var(--text-faint)]">
          Unchecking a circle removes access instantly — that&apos;s how you
          remove someone from one. Private 1:1 chats stay between the two people.
        </p>
      </div>
    </main>
  );
}
