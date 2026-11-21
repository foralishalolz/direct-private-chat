"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ChatStoreProvider, useChatStore } from "@/hooks/useChatStore";
import { Spinner } from "@/components/ui/Misc";
import type { Group } from "@/types/chat";

function ShellGate() {
  const params = useSearchParams();
  const { isReady, user, groups, isLoadingGroups } = useChatStore();
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [initialGroupHandled, setInitialGroupHandled] = useState(false);

  const openGroupById = useCallback(
    (groupId: string | null) => {
      if (!groupId) return;
      const match = groups.find((group) => group.id === groupId);
      if (match) setSelectedGroup(match);
    },
    [groups],
  );

  // Deep links: /?open=<groupId> (used by notification taps).
  useEffect(() => {
    if (initialGroupHandled || groups.length === 0) return;
    openGroupById(params.get("open"));
    setInitialGroupHandled(true);
  }, [groups, initialGroupHandled, openGroupById, params]);

  // Keep the open group in sync when the inbox refreshes it (unread counts,
  // partner profile, latest preview) without remounting the whole chat.
  const liveGroup = selectedGroup
    ? (groups.find((group) => group.id === selectedGroup.id) ?? selectedGroup)
    : null;

  if (!isReady || !user) {
    return (
      <main className="hero-bg grid min-h-dvh w-full place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-6" />
          <p className="text-[13px] text-[var(--text-faint)]">Opening BitchAt…</p>
        </div>
      </main>
    );
  }

  return (
    <AppShell
      selectedGroup={liveGroup}
      onSelectGroup={setSelectedGroup}
      onOpenGroupById={openGroupById}
      isLoadingGroups={isLoadingGroups}
    />
  );
}

export default function HomePage() {
  return (
    <ChatStoreProvider>
      <Suspense
        fallback={
          <main className="hero-bg grid min-h-dvh w-full place-items-center">
            <Spinner className="size-6" />
          </main>
        }
      >
        <ShellGate />
      </Suspense>
    </ChatStoreProvider>
  );
}
