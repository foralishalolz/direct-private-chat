"use client";

import { LoaderCircle, Search } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BottomNav, type AppTab } from "@/components/BottomNav";
import { ChatRoom } from "@/components/ChatRoom";
import { CouplesView } from "@/components/couples/CouplesView";
import { InstallPrompt } from "@/components/InstallPrompt";
import { GroupList } from "@/components/GroupList";
import { ProfileView } from "@/components/ProfileView";
import { SearchOverlay } from "@/components/SearchOverlay";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Group, Profile } from "@/types/chat";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [tab, setTab] = useState<AppTab>("chats");
  const [searchOpen, setSearchOpen] = useState(false);
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);

  const loadGroupsAndProfile = useCallback(async (userId: string) => {
    if (!supabase) return;

    const [profileResult, membershipResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, role")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("group_members").select("group_id").eq("user_id", userId),
    ]);

    if (profileResult.data) {
      setProfile(profileResult.data as Profile);
    }

    const groupIds = (membershipResult.data ?? []).map((row) => row.group_id as string);

    if (groupIds.length === 0) {
      setGroups([]);
      setIsLoadingGroups(false);
      return;
    }

    const { data: groupsData } = await supabase
      .from("groups")
      .select("id, name, description, created_at")
      .in("id", groupIds)
      .order("created_at", { ascending: true });

    setGroups((groupsData ?? []) as Group[]);
    setIsLoadingGroups(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      router.replace("/login");
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      setIsReady(true);

      if (!sessionUser) {
        router.replace("/login");
        return;
      }

      void loadGroupsAndProfile(sessionUser.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;

      setUser(session?.user ?? null);
      setIsReady(true);

      if (!session) {
        router.replace("/login");
        return;
      }

      void loadGroupsAndProfile(session.user.id);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, loadGroupsAndProfile]);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function openSearch() {
    setSearchOpen(true);
  }

  function handleJumpToMessage(group: Group, messageId: string) {
    setSearchOpen(false);
    setJumpMessageId(messageId);
    setTab("chats");
    setSelectedGroup(group);
  }

  function handleSelectGroup(group: Group) {
    setJumpMessageId(null);
    setSelectedGroup(group);
  }

  if (!isReady || !user) {
    return (
      <main className="grid h-dvh w-full place-items-center bg-[var(--bg)]">
        <LoaderCircle
          aria-hidden="true"
          className="size-6 animate-spin text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      </main>
    );
  }

  // Full-screen chat view — no tab bar (like a native app).
  if (selectedGroup) {
    return (
      <ChatRoom
        key={selectedGroup.id}
        user={user}
        currentProfile={profile}
        group={selectedGroup}
        initialMessageId={jumpMessageId}
        onBack={() => setSelectedGroup(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      <ServiceWorkerRegistration />
      <header className="safe-header fixed inset-x-0 top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-2)]/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-2">
          <button
            type="button"
            onClick={openSearch}
            className="group flex min-w-0 flex-1 max-w-xs items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-left transition hover:border-[var(--border-strong)]"
          >
            <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.8} />
            <span className="truncate text-sm text-[var(--text-muted)] group-hover:text-[var(--text-faint)]">
              Search chats, messages, plans…
            </span>
          </button>

          <div className="flex items-center gap-1">
            {tab === "chats" && (
              <span className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] sm:inline-flex">
                Private
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="absolute inset-x-0 top-[var(--chat-header-height)] bottom-[var(--tabbar-height)] overflow-hidden">
        {tab === "chats" && (
          <GroupList
            profile={profile}
            fallbackUsername={user.email?.split("@")[0] ?? ""}
            groups={groups}
            isLoading={isLoadingGroups}
            onSelect={handleSelectGroup}
          />
        )}
        {tab === "couples" && (
          <CouplesView user={user} profile={profile} />
        )}
        {tab === "profile" && (
          <ProfileView
            user={user}
            profile={profile}
            onSignOut={() => void handleSignOut()}
            onOpenSearch={openSearch}
          />
        )}
      </div>

      <BottomNav active={tab} onChange={setTab} />

      <InstallPrompt />

      {searchOpen && (
        <SearchOverlay
          user={user}
          groups={groups}
          onClose={() => setSearchOpen(false)}
          onJumpToMessage={handleJumpToMessage}
          onOpenCouples={() => {
            setSearchOpen(false);
            setTab("couples");
          }}
        />
      )}
    </div>
  );
}
