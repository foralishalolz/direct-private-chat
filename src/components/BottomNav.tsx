"use client";

import { Heart, MessageCircleMore, UserRound } from "lucide-react";

export type AppTab = "chats" | "couples" | "profile";

interface BottomNavProps {
  active: AppTab;
  onChange: (tab: AppTab) => void;
}

const TABS: { id: AppTab; label: string; icon: typeof MessageCircleMore }[] = [
  { id: "chats", label: "Chats", icon: MessageCircleMore },
  { id: "couples", label: "Couples", icon: Heart },
  { id: "profile", label: "Profile", icon: UserRound },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav
      aria-label="Main navigation"
      className="safe-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--bg-2)]/85 backdrop-blur-2xl"
    >
      <div className="mx-auto flex h-16 w-full max-w-3xl items-stretch justify-around px-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[11px] font-medium transition-colors ${
                isActive ? "text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 h-9 w-14 rounded-full bg-[var(--grad-soft)]"
                />
              )}
              <Icon
                aria-hidden="true"
                className="relative size-5"
                strokeWidth={isActive ? 2.2 : 1.7}
              />
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
