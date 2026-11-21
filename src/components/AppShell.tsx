"use client";

import { Heart, MessageCircle, Moon, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useChatStore } from "@/hooks/useChatStore";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { Inbox } from "@/components/Inbox";
import { CoupleHub } from "@/components/couple/CoupleHub";
import { SearchPanel } from "@/components/SearchPanel";
import { ProfileSheet } from "@/components/ProfileSheet";
import { NewChatSheet } from "@/components/NewChatSheet";
import { OfflineBanner } from "@/components/OfflineBanner";
import type { Group } from "@/types/chat";

export type Tab = "chats" | "us" | "search";

interface AppShellProps {
  selectedGroup: Group | null;
  onSelectGroup: (group: Group | null) => void;
  onOpenGroupById: (groupId: string | null) => void;
  isLoadingGroups: boolean;
}

const TABS: Array<{ id: Tab; label: string; icon: typeof MessageCircle }> = [
  { id: "chats", label: "Chats", icon: MessageCircle },
  { id: "us", label: "Us", icon: Heart },
  { id: "search", label: "Search", icon: Search },
];

export function AppShell({
  selectedGroup,
  onSelectGroup,
  onOpenGroupById,
  isLoadingGroups,
}: AppShellProps) {
  const { totalUnread, unreadByGroup, markGroupRead } = useChatStore();
  const [tab, setTab] = useState<Tab>("chats");
  const [profileOpen, setProfileOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const network = useNetworkStatus();

  const handleOpenGroup = useCallback(
    (group: Group) => {
      onSelectGroup(group);
      void markGroupRead(group.id);
    },
    [markGroupRead, onSelectGroup],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    if (requestedTab === "us" || requestedTab === "search" || requestedTab === "chats") {
      setTab(requestedTab);
    }
  }, []);

  const chatsUnread = Object.values(unreadByGroup).reduce(
    (sum, value) => sum + value,
    0,
  );

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[var(--bg)]">
      <OfflineBanner online={network.online} slow={network.slow} />

      <div
        className={`transition-[padding] duration-200 ${
          network.online && network.slow ? "pt-8" : network.online ? "pt-0" : "pt-8"
        }`}
      >
        {tab === "chats" && (
          <Inbox
            isLoading={isLoadingGroups}
            onOpenGroup={handleOpenGroup}
            onOpenProfile={() => setProfileOpen(true)}
            onNewChat={() => setNewChatOpen(true)}
          />
        )}
        {tab === "us" && <CoupleHub onOpenGroup={handleOpenGroup} />}
        {tab === "search" && (
          <SearchPanel
            onOpenGroup={handleOpenGroup}
            onOpenProfile={() => setProfileOpen(true)}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav className="app-tabbar glass fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-lg items-stretch justify-around">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            const badge = id === "chats" ? chatsUnread : 0;

            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  if (id !== "chats") onSelectGroup(null);
                }}
                aria-current={active ? "page" : undefined}
                className="press relative flex flex-1 flex-col items-center gap-1 py-2"
              >
                <span className="relative">
                  <Icon
                    className={`size-[22px] transition-colors ${
                      active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
                    }`}
                    strokeWidth={active ? 2.4 : 1.9}
                    fill={active && id === "us" ? "currentColor" : "none"}
                  />
                  {badge > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 grid min-w-[17px] place-items-center rounded-full accent-gradient px-1 text-[10px] font-bold leading-[17px] text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                    active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
                  }`}
                >
                  {label}
                </span>
                {active && (
                  <span className="absolute -top-px h-0.5 w-8 rounded-full accent-gradient" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Chat overlay */}
      {selectedGroup && (
        <ChatRoom
          key={selectedGroup.id}
          group={selectedGroup}
          onBack={() => onSelectGroup(null)}
        />
      )}

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      <NewChatSheet
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={(group) => {
          setNewChatOpen(false);
          onOpenGroupById(group.id);
          handleOpenGroup(group);
        }}
      />

      {/* Screen-reader live region for unread total */}
      <span className="sr-only" aria-live="polite">
        {totalUnread > 0 ? `${totalUnread} unread messages` : "No unread messages"}
        {network.online ? "" : " · You are offline"}
      </span>

      <span className="sr-only">
        <Moon aria-hidden="true" />
      </span>
    </div>
  );
}
