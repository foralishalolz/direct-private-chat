"use client";

import type { RealtimeChannel, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { playIncoming } from "@/lib/sound";
import type { Group, Profile } from "@/types/chat";

interface ChatStoreValue {
  user: User | null;
  profile: Profile | null;
  groups: Group[];
  isLoadingGroups: boolean;
  isReady: boolean;
  onlineUserIds: Set<string>;
  /** Latest unread count per group id. */
  unreadByGroup: Record<string, number>;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  refreshGroups: () => Promise<void>;
  markGroupRead: (groupId: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => void;
  totalUnread: number;
}

const ChatStoreContext = createContext<ChatStoreValue | null>(null);

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, number>>({});
  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);

  const activeGroupRef = useRef<string | null>(null);
  const groupsRef = useRef<Group[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const lastNotifiedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const setActiveGroupId = useCallback((id: string | null) => {
    activeGroupRef.current = id;
    setActiveGroupIdState(id);
    if (id) {
      setUnreadByGroup((current) => ({ ...current, [id]: 0 }));
    }
  }, []);

  const loadProfileAndGroups = useCallback(async (userId: string) => {
    if (!supabase) return;

    const [profileResult, membershipResult] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, username, role, display_name, avatar_url, accent, bio, couple_role, last_seen_at",
        )
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("group_members")
        .select("group_id, last_read_at, muted")
        .eq("user_id", userId),
    ]);

    if (profileResult.data) {
      setProfile(profileResult.data as Profile);
    }

    const memberships = membershipResult.data ?? [];
    const groupIds = memberships.map((row) => row.group_id as string);
    const readMap = new Map(
      memberships.map((row) => [
        row.group_id as string,
        (row.last_read_at as string) ?? new Date(0).toISOString(),
      ]),
    );

    if (groupIds.length === 0) {
      setGroups([]);
      setUnreadByGroup({});
      setIsLoadingGroups(false);
      return;
    }

    const { data: groupsData } = await supabase
      .from("groups")
      .select("id, name, description, created_by, is_direct, created_at")
      .in("id", groupIds)
      .order("created_at", { ascending: false });

    const normalized = (groupsData ?? []).map((group) => ({
      ...group,
      is_direct: Boolean(group.is_direct),
    })) as Group[];

    // Fetch the most recent message per group for previews, plus counts of
    // anything newer than our last-read marker for the unread badges. Direct
    // chats also resolve the other person so the inbox can show their face and
    // name instead of a synthetic "a :: b" title.
    const memberRows = await supabase
      .from("group_members")
      .select("group_id, user_id")
      .in("group_id", groupIds);

    const membersByGroup = new Map<string, string[]>();
    for (const row of memberRows.data ?? []) {
      const key = row.group_id as string;
      membersByGroup.set(key, [...(membersByGroup.get(key) ?? []), row.user_id as string]);
    }

    const partnerIds = [
      ...new Set(
        normalized
          .filter((group) => group.is_direct)
          .flatMap((group) =>
            (membersByGroup.get(group.id) ?? []).filter((id) => id !== userId),
          ),
      ),
    ];

    const partnerMap: Record<string, Profile> = {};
    if (partnerIds.length > 0) {
      const { data: partners } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, accent, last_seen_at, couple_role")
        .in("id", partnerIds);
      for (const request of partners ?? []) {
        partnerMap[request.id as string] = request as Profile;
      }
    }

    const enriched = await Promise.all(
      normalized.map(async (group) => {
        const [latest, unread] = await Promise.all([
          supabase!
            .from("messages")
            .select("content, kind, created_at, user_id, deleted_at")
            .eq("group_id", group.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase!
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("group_id", group.id)
            .is("deleted_at", null)
            .neq("user_id", userId)
            .gt("created_at", readMap.get(group.id) ?? new Date(0).toISOString()),
        ]);

        const memberIds = membersByGroup.get(group.id) ?? [];
        const partnerId = group.is_direct
          ? memberIds.find((id) => id !== userId)
          : undefined;
        const partnerProfile = partnerId ? partnerMap[partnerId] : undefined;

        return {
          ...group,
          last_message_at: latest.data?.created_at ?? group.created_at,
          last_message_preview: latest.data?.content ?? null,
          last_message_kind: (latest.data?.kind ?? null) as Group["last_message_kind"],
          unread_count: unread.count ?? 0,
          member_count: memberIds.length,
          muted: Boolean(
            memberships.find((row) => row.group_id === group.id)?.muted,
          ),
          partner: partnerProfile
            ? {
                id: partnerProfile.id,
                name:
                  partnerProfile.display_name?.trim() ||
                  partnerProfile.username,
                username: partnerProfile.username,
                avatar_url: partnerProfile.avatar_url ?? null,
                accent: partnerProfile.accent ?? null,
                last_seen_at: partnerProfile.last_seen_at ?? null,
                couple_role: partnerProfile.couple_role ?? null,
              }
            : null,
        } as Group;
      }),
    );

    enriched.sort((left, right) => {
      const leftTime = new Date(left.last_message_at ?? left.created_at).getTime();
      const rightTime = new Date(right.last_message_at ?? right.created_at).getTime();
      return rightTime - leftTime;
    });

    setGroups(enriched);
    setUnreadByGroup(
      Object.fromEntries(enriched.map((group) => [group.id, group.unread_count ?? 0])),
    );
    setIsLoadingGroups(false);
  }, []);

  const refreshGroups = useCallback(async () => {
    if (!user) return;
    await loadProfileAndGroups(user.id);
  }, [loadProfileAndGroups, user]);

  // Auth bootstrap.
  useEffect(() => {
    if (!supabase) {
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
      void loadProfileAndGroups(sessionUser.id);
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
      void loadProfileAndGroups(session.user.id);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, loadProfileAndGroups]);

  // Live presence: who of my people is online right now.
  useEffect(() => {
    if (!supabase || !user) return;

    const channel = supabase.channel("bitchat-presence", {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUserIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    presenceChannelRef.current = channel;

    // Heartbeat last_seen so "active 2m ago" stays accurate when backgrounded.
    const heartbeat = setInterval(() => {
      void supabase
        ?.from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", user.id);
    }, 60_000);

    void supabase
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", user.id);

    return () => {
      clearInterval(heartbeat);
      void supabase?.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, [user]);

  // Global new-message listener: keeps list previews, unread badges, and the
  // in-app chime in sync even when you're not inside a specific chat.
  useEffect(() => {
    if (!supabase || !user) return;

    const channel = supabase
      .channel("bitchat-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as {
            id: string;
            group_id: string;
            user_id: string;
            content: string;
            kind: string;
            created_at: string;
          };

          const knownGroup = groupsRef.current.some(
            (group) => group.id === message.group_id,
          );

          if (!knownGroup) {
            // A brand-new chat we weren't aware of — refresh the list.
            void refreshGroups();
            return;
          }

          setGroups((current) => {
            const next = current.map((group) =>
              group.id === message.group_id
                ? {
                    ...group,
                    last_message_at: message.created_at,
                    last_message_preview: message.content,
                    last_message_kind: message.kind as Group["last_message_kind"],
                  }
                : group,
            );
            next.sort((left, right) => {
              const leftTime = new Date(left.last_message_at ?? left.created_at).getTime();
              const rightTime = new Date(right.last_message_at ?? right.created_at).getTime();
              return rightTime - leftTime;
            });
            return next;
          });

          const isActive = activeGroupRef.current === message.group_id;

          if (message.user_id !== user.id && !isActive) {
            setUnreadByGroup((current) => ({
              ...current,
              [message.group_id]: (current[message.group_id] ?? 0) + 1,
            }));

            // Chime at most once every 4s per group to avoid noise.
            const last = lastNotifiedRef.current[message.group_id] ?? 0;
            if (Date.now() - last > 4000) {
              lastNotifiedRef.current[message.group_id] = Date.now();
              if (localStorage.getItem("bitchat-sounds") !== "off") playIncoming();
            }
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      void supabase?.removeChannel(channel);
      channelRef.current = null;
    };
  }, [refreshGroups, user]);

  const markGroupRead = useCallback(
    async (groupId: string) => {
      if (!supabase || !user) return;

      setUnreadByGroup((current) => ({ ...current, [groupId]: 0 }));

      await supabase
        .from("group_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("user_id", user.id);
    },
    [user],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }, [router]);

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const totalUnread = useMemo(
    () => Object.values(unreadByGroup).reduce((sum, value) => sum + value, 0),
    [unreadByGroup],
  );

  const value = useMemo<ChatStoreValue>(
    () => ({
      user,
      profile,
      groups,
      isLoadingGroups,
      isReady,
      onlineUserIds,
      unreadByGroup,
      activeGroupId,
      setActiveGroupId,
      refreshGroups,
      markGroupRead,
      signOut,
      updateProfile,
      totalUnread,
    }),
    [
      user,
      profile,
      groups,
      isLoadingGroups,
      isReady,
      onlineUserIds,
      unreadByGroup,
      activeGroupId,
      setActiveGroupId,
      refreshGroups,
      markGroupRead,
      signOut,
      updateProfile,
      totalUnread,
    ],
  );

  return (
    <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>
  );
}

export function useChatStore(): ChatStoreValue {
  const context = useContext(ChatStoreContext);
  if (!context) {
    throw new Error("useChatStore must be used inside <ChatStoreProvider>");
  }
  return context;
}
