"use client";

import {
  BellOff,
  BellRing,
  CalendarHeart,
  Crown,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Misc";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/hooks/useChatStore";
import { displayName, isOnline, lastSeenLabel } from "@/lib/utils";
import type { Group, Profile } from "@/types/chat";

interface ChatInfoSheetProps {
  open: boolean;
  onClose: () => void;
  group: Group | null;
  groupName: string;
  isDirect: boolean;
  partner: Profile | null;
  profiles: Record<string, Profile>;
  currentUserId: string;
  reactionsCount: number;
  onBack: () => void;
}

export function ChatInfoSheet({
  open,
  onClose,
  group,
  groupName,
  isDirect,
  partner,
  profiles,
  currentUserId,
  reactionsCount,
  onBack,
}: ChatInfoSheetProps) {
  const router = useRouter();
  const { onlineUserIds, markGroupRead } = useChatStore();
  const [muted, setMuted] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [messageCount, setMessageCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !group || !supabase) return;
    let active = true;

    void Promise.all([
      supabase
        .from("group_members")
        .select("user_id, muted")
        .eq("group_id", group.id),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", group.id)
        .is("deleted_at", null),
      supabase
        .from("group_members")
        .select("muted")
        .eq("group_id", group.id)
        .eq("user_id", currentUserId)
        .maybeSingle(),
    ]).then(([members, count, mine]) => {
      if (!active) return;
      setMemberCount(members.data?.length ?? 0);
      setMessageCount(count.count ?? 0);
      setMuted(Boolean(mine.data?.muted));
    });

    return () => {
      active = false;
    };
  }, [currentUserId, group, open]);

  async function toggleMute() {
    if (!group || !supabase) return;
    const next = !muted;
    setMuted(next);
    await supabase
      .from("group_members")
      .update({ muted: next })
      .eq("group_id", group.id)
      .eq("user_id", currentUserId);
  }

  async function clearHistory() {
    if (!group || !supabase) return;
    if (!confirm("Delete every message in this chat? This can't be undone.")) return;

    // Only rows you're allowed to delete (your own) — admins can nuke all.
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", currentUserId);

    if (!error) {
      onClose();
      onBack();
    }
  }

  const members = Object.values(profiles).filter((person) => person.id !== currentUserId);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isDirect ? displayName(partner) || groupName : groupName}
      description={group?.description ?? undefined}
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center py-2">
          <Avatar
            name={isDirect ? displayName(partner) : groupName}
            seed={partner?.id ?? group?.id ?? groupName}
            src={partner?.avatar_url}
            size={84}
            ring
            online={partner ? onlineUserIds.has(partner.id) : false}
            accent={isDirect ? "linear-gradient(140deg,#fb7185,#a855f7)" : undefined}
          />
          <p className="mt-3 flex items-center gap-1.5 text-[15px] font-bold text-[var(--text)]">
            {isDirect ? (
              <>
                <Heart className="size-4 fill-[var(--accent)] text-[var(--accent)]" />
                Just us
              </>
            ) : (
              <>
                <Users className="size-4" strokeWidth={2.2} />
                {memberCount ?? "—"} members
              </>
            )}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            {partner
              ? isOnline(partner.last_seen_at) || onlineUserIds.has(partner.id)
                ? "Active now"
                : lastSeenLabel(partner.last_seen_at)
              : `${messageCount ?? "—"} messages · ${reactionsCount} reactions`}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push("/?tab=us");
            }}
            className="press flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-3"
          >
            <CalendarHeart className="size-5 text-[var(--accent)]" strokeWidth={1.9} />
            <span className="text-[11.5px] font-semibold text-[var(--text-soft)]">Plans</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push("/?tab=us&panel=games");
            }}
            className="press flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-3"
          >
            <Gamepad2 className="size-5 text-[var(--accent-2)]" strokeWidth={1.9} />
            <span className="text-[11.5px] font-semibold text-[var(--text-soft)]">Games</span>
          </button>
          <button
            type="button"
            onClick={() => void toggleMute()}
            className="press flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-3"
          >
            {muted ? (
              <BellOff className="size-5 text-[var(--warning)]" strokeWidth={1.9} />
            ) : (
              <BellRing className="size-5 text-[var(--text-soft)]" strokeWidth={1.9} />
            )}
            <span className="text-[11.5px] font-semibold text-[var(--text-soft)]">
              {muted ? "Muted" : "Mute"}
            </span>
          </button>
        </div>

        {!isDirect && members.length > 0 && (
          <div>
            <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              In this circle
            </p>
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
              {members.map((person) => (
                <div key={person.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Avatar
                    name={displayName(person)}
                    seed={person.id}
                    src={person.avatar_url}
                    size={34}
                    online={onlineUserIds.has(person.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--text)]">
                    {displayName(person)}
                  </span>
                  {person.role === "admin" && (
                    <Pill tone="accent">
                      <Crown className="size-2.5" strokeWidth={2.6} />
                      admin
                    </Pill>
                  )}
                  <span className="text-[11px] text-[var(--text-faint)]">
                    {onlineUserIds.has(person.id) ? (
                      <span className="text-[var(--success)]">online</span>
                    ) : (
                      lastSeenLabel(person.last_seen_at)
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <Button
            variant="secondary"
            fullWidth
            icon={<Sparkles className="size-4" />}
            onClick={() => {
              onClose();
              markGroupRead(group?.id ?? "");
            }}
          >
            Mark all as read
          </Button>
          <Button
            variant="danger"
            fullWidth
            icon={<Trash2 className="size-4" />}
            onClick={() => void clearHistory()}
          >
            Delete my messages here
          </Button>
        </div>

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-[var(--text-faint)]">
          <ImageIcon className="size-3" strokeWidth={2.2} />
          Photos & voices are private to this chat
          <UserRound className="size-3" strokeWidth={2.2} />
        </p>
      </div>
    </Sheet>
  );
}
