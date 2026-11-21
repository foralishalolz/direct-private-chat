"use client";

import { Bell, BellOff, Download, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { supabase } from "@/lib/supabase";
import { isPushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import type { Profile } from "@/types/chat";

interface ProfileViewProps {
  user: User;
  profile: Profile | null;
  onSignOut: () => void;
  onOpenSearch: () => void;
}

export function ProfileView({ user, profile, onSignOut }: ProfileViewProps) {
  const client = supabase;
  const displayName = profile?.username ?? user.email?.split("@")[0] ?? "";
  const isAdmin = profile?.role === "admin";

  const [pushState, setPushState] = useState<"unknown" | "on" | "off" | "unsupported">("unknown");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!isPushSupported()) {
        if (active) setPushState("unsupported");
        return;
      }
      const sub = await getPushSubscription();
      if (!active) return;
      setPushState(sub ? "on" : "off");
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleTogglePush() {
    if (!client || isBusy) return;
    setIsBusy(true);

    if (pushState === "on") {
      await unsubscribeFromPush(client);
      setPushState("off");
    } else {
      const ok = await subscribeToPush(client, user.id);
      setPushState(ok ? "on" : "off");
    }

    setIsBusy(false);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <Avatar seed={user.id} name={displayName} className="size-20" textClassName="text-2xl" />
          <h1 className="mt-3 text-[22px] font-bold tracking-tight">{displayName}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
            {isAdmin && <ShieldCheck aria-hidden="true" className="size-4 text-[var(--accent-text)]" strokeWidth={1.8} />}
            {isAdmin ? "Admin" : "Member"}
          </p>
        </div>

        <div className="space-y-3">
          <div
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
          >
            {pushState === "unsupported" ? (
              <BellOff aria-hidden="true" className="size-5 shrink-0 text-[var(--text-muted)]" strokeWidth={1.8} />
            ) : pushState === "on" ? (
              <Bell aria-hidden="true" className="size-5 shrink-0 text-[var(--text)]" strokeWidth={1.8} />
            ) : (
              <Bell aria-hidden="true" className="size-5 shrink-0 text-[var(--text-muted)]" strokeWidth={1.8} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">Push notifications</p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">
                {pushState === "unsupported"
                  ? "This browser doesn't support push"
                  : pushState === "on"
                    ? "You’ll get notified about new messages"
                    : pushState === "off"
                      ? "Turn on to get notified about new messages"
                      : "Checking…"}
              </p>
            </div>
            {pushState !== "unsupported" && (
              <button
                type="button"
                onClick={() => void handleTogglePush()}
                disabled={isBusy || pushState === "unknown"}
                role="switch"
                aria-checked={pushState === "on"}
                aria-label="Toggle push notifications"
                className={`relative h-8 w-14 shrink-0 rounded-full transition ${
                  pushState === "on" ? "bg-[var(--accent-text)]" : "bg-[var(--panel-2)]"
                } ${isBusy ? "opacity-60" : ""}`}
              >
                {isBusy ? (
                  <LoaderCircle aria-hidden="true" className="absolute inset-0 m-auto size-4 animate-spin text-white" strokeWidth={2.2} />
                ) : (
                  <span
                    className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${
                      pushState === "on" ? "left-7" : "left-1"
                    }`}
                  />
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <Download aria-hidden="true" className="size-5 shrink-0 text-[var(--text-muted)]" strokeWidth={1.8} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">Install as an app</p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">
                Add Direct to your home screen for a native-like experience
              </p>
            </div>
            <span className="chip">Add to Home Screen</span>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4 text-[14px] font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)]/15 active:scale-[0.99]"
          >
            <LogOut aria-hidden="true" className="size-4" strokeWidth={2} />
            Sign out
          </button>

          <p className="pt-2 text-center text-[11px] text-[var(--text-faint)]">Direct · private chat · v1.0</p>
        </div>
      </div>
    </div>
  );
}
