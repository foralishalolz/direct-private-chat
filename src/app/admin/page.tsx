"use client";

import { LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
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
      <main className="grid h-dvh w-full place-items-center bg-[var(--tg-panel)]">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-[var(--tg-text-muted)]"
          strokeWidth={1.75}
        />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[var(--tg-bg)] pb-16">
      <header className="border-b border-[var(--tg-border)] bg-[var(--tg-panel)]">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5 text-[var(--tg-text)]" strokeWidth={1.8} />
            <span className="text-[15px] font-semibold text-[var(--tg-text)]">Admin dashboard</span>
          </div>
          <Link
            href="/"
            className="text-[14px] font-medium text-[var(--tg-text-muted)] transition hover:text-[var(--tg-text)]"
          >
            Back to chat
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
        {loadError && (
          <div className="rounded-xl border border-[var(--tg-danger)]/40 bg-[var(--tg-danger)]/10 px-4 py-3 text-sm text-[var(--tg-danger)]">
            {loadError}
          </div>
        )}

        <section className="rounded-2xl border border-[var(--tg-border)] bg-[var(--tg-panel)] p-5">
          <h2 className="text-[15px] font-semibold text-[var(--tg-text)]">Create a group</h2>
          <p className="mt-0.5 text-[13px] text-[var(--tg-text-muted)]">
            Only you can create groups. New groups start empty — add members below.
          </p>

          <form onSubmit={handleCreateGroup} className="mt-4 space-y-3">
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Group name (e.g. Valorant)"
              maxLength={60}
              className="w-full rounded-xl border border-[var(--tg-border)] px-3.5 py-2.5 text-[14px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-muted)] focus:border-[var(--tg-accent)]"
            />
            <input
              value={newGroupDescription}
              onChange={(event) => setNewGroupDescription(event.target.value)}
              placeholder="Description (optional)"
              maxLength={200}
              className="w-full rounded-xl border border-[var(--tg-border)] px-3.5 py-2.5 text-[14px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-muted)] focus:border-[var(--tg-accent)]"
            />

            {createError && <p className="text-[13px] text-[var(--tg-danger)]">{createError}</p>}

            <button
              type="submit"
              disabled={isCreatingGroup || !newGroupName.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--tg-accent)] px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-[var(--tg-accent-strong)] disabled:opacity-40"
            >
              {isCreatingGroup ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
              )}
              Create group
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-[var(--tg-border)] bg-[var(--tg-panel)] p-5">
          <h2 className="text-[15px] font-semibold text-[var(--tg-text)]">Groups</h2>

          {isLoadingData ? (
            <div className="mt-4 grid place-items-center py-6">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-[var(--tg-text-muted)]" strokeWidth={1.8} />
            </div>
          ) : groups.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--tg-text-muted)]">No groups yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--tg-border)]">
              {groups.map((group) => (
                <li key={group.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-[var(--tg-text)]">{group.name}</div>
                    {group.description && (
                      <div className="truncate text-[12px] text-[var(--tg-text-muted)]">{group.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteGroup(group.id)}
                    disabled={deletingGroupId === group.id}
                    aria-label={`Delete ${group.name}`}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--tg-text-muted)] transition hover:bg-[var(--tg-danger)]/10 hover:text-[var(--tg-danger)] disabled:opacity-40"
                  >
                    {deletingGroupId === group.id ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--tg-border)] bg-[var(--tg-panel)] p-5">
          <h2 className="text-[15px] font-semibold text-[var(--tg-text)]">Users &amp; group access</h2>
          <p className="mt-0.5 text-[13px] text-[var(--tg-text-muted)]">
            Pick which groups each person can see and chat in. Unchecking a group removes their access to it immediately.
          </p>

          {isLoadingData ? (
            <div className="mt-4 grid place-items-center py-6">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-[var(--tg-text-muted)]" strokeWidth={1.8} />
            </div>
          ) : users.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--tg-text-muted)]">No users yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--tg-border)]">
              {users.map((user) => (
                <li key={user.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-[var(--tg-text)]">
                          {user.username}
                        </span>
                        {user.role === "admin" && (
                          <span className="shrink-0 rounded-full bg-[var(--tg-accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[12px] text-[var(--tg-text-muted)]">
                        {user.groupIds.length} group{user.groupIds.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAccessMenu(user)}
                      className="shrink-0 rounded-full border border-[var(--tg-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--tg-text)] transition hover:bg-[var(--tg-bg)]"
                    >
                      Manage groups
                    </button>
                  </div>

                  {openUserId === user.id && (
                    <div className="mt-3 rounded-xl border border-[var(--tg-border)] bg-[var(--tg-bg)] p-3">
                      {groups.length === 0 ? (
                        <p className="text-[13px] text-[var(--tg-text-muted)]">Create a group first.</p>
                      ) : (
                        <div className="space-y-2">
                          {groups.map((group) => (
                            <label
                              key={group.id}
                              className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[var(--tg-text)]"
                            >
                              <input
                                type="checkbox"
                                checked={pendingGroupIds.includes(group.id)}
                                onChange={() => toggleGroupForPendingUser(group.id)}
                                className="size-4 rounded border-[var(--tg-border)] accent-[var(--tg-accent)]"
                              />
                              {group.name}
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveAccess(user.id)}
                          disabled={isSavingAccess}
                          className="flex items-center gap-1.5 rounded-lg bg-[var(--tg-accent)] px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-[var(--tg-accent-strong)] disabled:opacity-40"
                        >
                          {isSavingAccess && (
                            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" strokeWidth={2} />
                          )}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenUserId(null)}
                          className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-[var(--tg-text-muted)] transition hover:bg-[var(--tg-hover)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
