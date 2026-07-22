"use client";

import { LoaderCircle } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChatRoom } from "@/components/ChatRoom";
import { GroupList } from "@/components/GroupList";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Group, Profile } from "@/types/chat";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
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

  if (!isReady || !user) {
    return (
      <main className="grid h-dvh w-full place-items-center bg-[var(--tg-bg)]">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-[var(--tg-text-muted)]"
          strokeWidth={1.75}
        />
      </main>
    );
  }

  if (selectedGroup) {
    return (
      <ChatRoom
        key={selectedGroup.id}
        user={user}
        currentProfile={profile}
        group={selectedGroup}
        onBack={() => setSelectedGroup(null)}
      />
    );
  }

  return (
    <GroupList
      profile={profile}
      fallbackUsername={user.email?.split("@")[0] ?? ""}
      groups={groups}
      isLoading={isLoadingGroups}
      onSelect={setSelectedGroup}
      onSignOut={() => void handleSignOut()}
    />
  );
}
