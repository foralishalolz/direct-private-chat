"use client";

import {
  Cat,
  ChevronRight,
  Clock,
  Gamepad2,
  Heart,
  HeartHandshake,
  MessageCircleHeart,
  PartyPopper,
  Plus,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useChatStore } from "@/hooks/useChatStore";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState, Pill, SectionTitle } from "@/components/ui/Misc";
import { PlanSheet } from "@/components/couple/PlanSheet";
import { PlanCard } from "@/components/couple/PlanCard";
import { LoveNotesSheet } from "@/components/couple/LoveNotesSheet";
import { GamesSheet } from "@/components/games/GamesSheet";
import { showLocalNotification } from "@/lib/push";
import { playReminder, playSparkle } from "@/lib/sound";
import {
  displayName,
  formatCountdown,
  isOnline,
  lastSeenLabel,
  timeAgo,
  vibrate,
} from "@/lib/utils";
import type { Group, LoveNote, Plan, Profile } from "@/types/chat";

interface CoupleHubProps {
  onOpenGroup: (group: Group) => void;
}

export function CoupleHub({ onOpenGroup }: CoupleHubProps) {
  const { groups, profile, user, onlineUserIds } = useChatStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notes, setNotes] = useState<LoveNote[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [pokeSent, setPokeSent] = useState<string | null>(null);
  const [poking, setPoking] = useState(false);

  const partnerGroup = useMemo(
    () => groups.find((group) => group.is_direct) ?? groups[0] ?? null,
    [groups],
  );
  const groupId = partnerGroup?.id ?? null;

  const partner = useMemo<Profile | null>(() => {
    if (!partnerGroup?.is_direct) return null;
    const member = Object.values(profiles).find((person) => person.id !== user?.id);
    if (member) return member;
    if (partnerGroup.partner) {
      return {
        id: partnerGroup.partner.id,
        username: partnerGroup.partner.username,
        display_name: partnerGroup.partner.name,
        avatar_url: partnerGroup.partner.avatar_url,
        accent: partnerGroup.partner.accent,
        last_seen_at: partnerGroup.partner.last_seen_at,
        couple_role: partnerGroup.partner.couple_role,
        role: "user",
      };
    }
    return null;
  }, [partnerGroup, profiles, user?.id]);

  const sendPoke = useCallback(
    async (kind: "miss" | "kiss" | "hug") => {
      if (!supabase || !groupId || poking) return;
      setPoking(true);

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          await fetch("/api/poke", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ groupId, kind }),
          });
        }
        if (localStorage.getItem("bitchat-sounds") !== "off") playSparkle();
        vibrate([12, 40, 12]);
        setPokeSent(kind);
        setTimeout(() => setPokeSent(null), 1800);
      } finally {
        setPoking(false);
      }
    },
    [groupId, poking],
  );

  const loadPlans = useCallback(async () => {
    if (!supabase || !groupId) return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("plans")
      .select("*")
      .eq("group_id", groupId)
      .gte("starts_at", new Date(todayStart.getTime() - 7 * 864e5).toISOString())
      .order("starts_at", { ascending: true })
      .limit(30);

    setPlans((data ?? []) as Plan[]);
  }, [groupId]);

  const loadNotes = useCallback(async () => {
    if (!supabase || !groupId) return;
    const { data } = await supabase
      .from("love_notes")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotes((data ?? []) as LoveNote[]);
  }, [groupId]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    void supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, accent, last_seen_at, couple_role")
      .then(({ data }) => {
        if (!active || !data) return;
        setProfiles(
          Object.fromEntries(data.map((row) => [row.id as string, row as Profile])),
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadPlans();
    void loadNotes();
  }, [loadNotes, loadPlans]);

  // Live plan + note updates, plus the "date is starting" nudge.
  useEffect(() => {
    if (!supabase || !groupId) return;

    const channel = supabase
      .channel(`couple-hub-${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plans", filter: `group_id=eq.${groupId}` },
        () => void loadPlans(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "love_notes", filter: `group_id=eq.${groupId}` },
        (payload) => {
          void loadNotes();
          if (payload.eventType === "INSERT" && (payload.new as LoveNote).user_id !== user?.id) {
            void showLocalNotification("A new love note 💌", {
              body: `${(payload.new as LoveNote).body.slice(0, 120)}`,
              tag: "love-note",
            });
          }
        },
      )
      .subscribe();

    const ticker = setInterval(() => {
      const soon = plans.find((plan) => {
        const diff = new Date(plan.starts_at).getTime() - Date.now();
        return !plan.completed && diff <= 5 * 60_000 && diff > 0;
      });
      if (soon && localStorage.getItem("bitchat-plan-nudged") !== soon.id) {
        localStorage.setItem("bitchat-plan-nudged", soon.id);
        if (localStorage.getItem("bitchat-sounds") !== "off") playReminder();
        void showLocalNotification(`Starting soon: ${soon.title}`, {
          body: `Your plan starts in about ${formatCountdown(soon.starts_at)}. 💗`,
          tag: `plan-${soon.id}`,
        });
      }
    }, 45_000);

    return () => {
      clearInterval(ticker);
      void supabase?.removeChannel(channel);
    };
  }, [groupId, loadNotes, loadPlans, plans, user?.id]);

  const upcoming = plans.filter(
    (plan) => !plan.completed && new Date(plan.starts_at).getTime() > Date.now() - 3_600_000,
  );
  const nextPlan = upcoming[0];
  const past = plans.filter((plan) => plan.completed);
  const latestNote = notes[0];

  const myRole = profile?.couple_role ?? null;
  const partnerRole = partner?.couple_role ?? null;

  const iAmKitten = myRole === "kitten";
  const iAmDada = myRole === "dada";

  if (!partnerGroup) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 pb-[calc(var(--app-tab-height)+1rem)]">
        <EmptyState
          icon={<HeartHandshake className="size-6" strokeWidth={1.7} />}
          title="Your couple space lives here"
          description="Once you're in a private chat with your person, this is where plans, games and love notes show up."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg pb-[calc(var(--app-tab-height)+1rem)]">
      {/* Hero */}
      <header className="hero-bg app-header relative overflow-hidden border-b border-[var(--border)]/50">
        <div className="flex h-[3.75rem] items-center justify-between">
          <div>
            <h1 className="text-[19px] font-extrabold tracking-tight text-[var(--text)]">
              Us
            </h1>
            <p className="text-[11.5px] font-medium text-[var(--text-muted)]">
              {partnerGroup.partner?.name ?? "Your little world"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="press grid size-9 place-items-center rounded-full bg-[var(--panel)]/70 text-[var(--accent)]"
              aria-label="Love notes"
            >
              <MessageCircleHeart className="size-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setGamesOpen(true)}
              className="press grid size-9 place-items-center rounded-full bg-[var(--panel)]/70 text-[var(--accent-2)]"
              aria-label="Games"
            >
              <Gamepad2 className="size-[18px]" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Couple card */}
        <div className="pb-5 pt-3">
          <div className="relative overflow-hidden rounded-[26px] border border-white/[0.07] bg-[var(--panel)]/70 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex flex-1 flex-col items-center gap-1.5">
                <Avatar
                  name={displayName(profile)}
                  seed={profile?.id ?? "me"}
                  src={profile?.avatar_url}
                  accent={profile?.accent}
                  size={64}
                  ring
                  online
                />
                <p className="max-w-[6.5rem] truncate text-[13px] font-bold text-[var(--text)]">
                  {displayName(profile)}
                </p>
                {myRole && (
                  <Pill tone={iAmKitten ? "accent" : "warning"}>
                    {iAmKitten ? (
                      <Cat className="size-2.5" strokeWidth={2.6} />
                    ) : (
                      <Heart className="size-2.5" strokeWidth={2.6} />
                    )}
                    {myRole}
                  </Pill>
                )}
              </div>

              <div className="flex flex-col items-center px-1">
                <div className="relative">
                  <Heart
                    className="size-7 animate-pulse-ring fill-[var(--accent)] text-[var(--accent)]"
                    strokeWidth={1.5}
                  />
                </div>
                <span className="mt-1.5 rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-faint)]">
                  {nextPlan ? formatCountdown(nextPlan.starts_at) : "together"}
                </span>
              </div>

              <div className="flex flex-1 flex-col items-center gap-1.5">
                <Avatar
                  name={displayName(partner)}
                  seed={partner?.id ?? "them"}
                  src={partner?.avatar_url}
                  accent={partner?.accent}
                  size={64}
                  ring
                  online={partner ? onlineUserIds.has(partner.id) : false}
                />
                <p className="max-w-[6.5rem] truncate text-[13px] font-bold text-[var(--text)]">
                  {displayName(partner)}
                </p>
                {partnerRole ? (
                  <Pill tone={partnerRole === "kitten" ? "accent" : "warning"}>
                    {partnerRole === "kitten" ? (
                      <Cat className="size-2.5" strokeWidth={2.6} />
                    ) : (
                      <Heart className="size-2.5" strokeWidth={2.6} />
                    )}
                    {partnerRole}
                  </Pill>
                ) : (
                  <span className="text-[10.5px] font-medium text-[var(--text-faint)]">
                    {partner
                      ? isOnline(partner.last_seen_at) || onlineUserIds.has(partner.id)
                        ? "active now"
                        : lastSeenLabel(partner.last_seen_at)
                      : "no partner yet"}
                  </span>
                )}
              </div>
            </div>

            {(iAmKitten || iAmDada) && (
              <p className="mt-3 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-center text-[11.5px] font-medium leading-snug text-[var(--accent)]">
                {iAmKitten
                  ? "Kitten mode on — ask for headpats and your dada will come running. 🐱"
                  : "Dada mode on — someone here needs a hug and a snack. 🫶"}
              </p>
            )}

            <div className="mt-2.5 flex items-center gap-1.5">
              {(
                [
                  { kind: "miss" as const, emoji: "💗", label: "Miss you" },
                  { kind: "kiss" as const, emoji: "💋", label: "Kiss" },
                  { kind: "hug" as const, emoji: "🫂", label: "Hug" },
                ] as const
              ).map((poke) => (
                <button
                  key={poke.kind}
                  type="button"
                  onClick={() => void sendPoke(poke.kind)}
                  disabled={poking}
                  className={`press flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border text-[11.5px] font-bold transition ${
                    pokeSent === poke.kind
                      ? "border-[var(--accent)]/60 bg-[var(--accent)]/22 text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--panel-2)]/70 text-[var(--text-soft)]"
                  }`}
                >
                  <span className="text-[13px]">{poke.emoji}</span>
                  {pokeSent === poke.kind ? "Sent!" : poke.label}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onOpenGroup(partnerGroup)}
                className="press flex h-10 items-center justify-center gap-1.5 rounded-full accent-gradient text-[13px] font-bold text-white"
              >
                <MessageCircleHeart className="size-4" strokeWidth={2.2} />
                Message
              </button>
              <button
                type="button"
                onClick={() => setPlanSheetOpen(true)}
                className="press flex h-10 items-center justify-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--panel-2)] text-[13px] font-bold text-[var(--text)]"
              >
                <Plus className="size-4" strokeWidth={2.6} />
                Plan a date
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-6 px-3 pt-5">
        {/* Next up */}
        {nextPlan && (
          <section>
            <SectionTitle
              action={
                <button
                  type="button"
                  onClick={() => setPlanSheetOpen(true)}
                  className="text-[11.5px] font-bold text-[var(--accent)]"
                >
                  All plans
                </button>
              }
            >
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3.5" strokeWidth={2.4} />
                Next up
              </span>
            </SectionTitle>
            <button
              type="button"
              onClick={() => {
                setEditingPlan(nextPlan);
                setPlanSheetOpen(true);
              }}
              className="press w-full overflow-hidden rounded-3xl border border-[var(--accent)]/25 bg-gradient-to-br from-[var(--accent)]/16 via-[var(--accent-2)]/10 to-transparent p-4 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
                    {nextPlan.category}
                  </span>
                  <p className="mt-1 truncate text-[17px] font-extrabold tracking-tight text-[var(--text)]">
                    {nextPlan.title}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[var(--text-soft)]">
                    {new Date(nextPlan.starts_at).toLocaleString(undefined, {
                      weekday: "long",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {nextPlan.location ? ` · ${nextPlan.location}` : ""}
                  </p>
                </div>
                <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-black/25 backdrop-blur">
                  <span className="text-[12px] font-extrabold text-[var(--accent)]">
                    {formatCountdown(nextPlan.starts_at)}
                  </span>
                </div>
              </div>
              {nextPlan.notes && (
                <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-[var(--text-muted)]">
                  {nextPlan.notes}
                </p>
              )}
            </button>
          </section>
        )}

        {upcoming.length > 1 && (
          <section>
            <SectionTitle>Coming up</SectionTitle>
            <div className="space-y-1.5">
              {upcoming.slice(1, 4).map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  compact
                  onClick={() => {
                    setEditingPlan(plan);
                    setPlanSheetOpen(true);
                  }}
                  onToggleComplete={async () => {
                    if (!supabase) return;
                    await supabase
                      .from("plans")
                      .update({ completed: true })
                      .eq("id", plan.id);
                    void loadPlans();
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Quick actions grid */}
        <section>
          <SectionTitle>For us</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="press flex flex-col items-start gap-2 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3.5 text-left"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
                <MessageCircleHeart className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="text-[13.5px] font-bold text-[var(--text)]">Love notes</span>
              <span className="text-[11.5px] leading-snug text-[var(--text-muted)]">
                {latestNote
                  ? `${latestNote.body.slice(0, 40)}…`
                  : "Leave something only they'll read"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setGamesOpen(true)}
              className="press flex flex-col items-start gap-2 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3.5 text-left"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-2)]/15 text-[var(--accent-2)]">
                <Gamepad2 className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="text-[13.5px] font-bold text-[var(--text)]">Play together</span>
              <span className="text-[11.5px] leading-snug text-[var(--text-muted)]">
                7 games, real-time turns
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPlanSheetOpen(true)}
              className="press flex flex-col items-start gap-2 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3.5 text-left"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-[var(--success)]/15 text-[var(--success)]">
                <Clock className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="text-[13.5px] font-bold text-[var(--text)]">Schedule</span>
              <span className="text-[11.5px] leading-snug text-[var(--text-muted)]">
                Dates, calls, movie nights
              </span>
            </button>

            <button
              type="button"
              onClick={() => onOpenGroup(partnerGroup)}
              className="press flex flex-col items-start gap-2 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3.5 text-left"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-[var(--info)]/15 text-[var(--info)]">
                <Heart className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="text-[13.5px] font-bold text-[var(--text)]">Our chat</span>
              <span className="text-[11.5px] leading-snug text-[var(--text-muted)]">
                {partnerGroup.last_message_preview
                  ? partnerGroup.last_message_preview.slice(0, 34)
                  : "Say hi 💗"}
              </span>
            </button>
          </div>
        </section>

        {past.length > 0 && (
          <section>
            <SectionTitle>
              <span className="inline-flex items-center gap-1.5">
                <PartyPopper className="size-3.5" strokeWidth={2.2} />
                Memories
              </span>
            </SectionTitle>
            <div className="space-y-1.5">
              {past.slice(0, 3).map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center gap-2.5 rounded-2xl bg-[var(--panel)]/60 px-3 py-2.5"
                >
                  <PartyPopper className="size-4 shrink-0 text-[var(--accent)]" strokeWidth={2} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[var(--text-soft)]">
                      {plan.title}
                    </p>
                    <p className="text-[11px] text-[var(--text-faint)]">
                      {timeAgo(plan.starts_at)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-[var(--text-faint)]" strokeWidth={2.2} />
                </div>
              ))}
            </div>
          </section>
        )}

        {!nextPlan && (
          <section>
            <Button
              fullWidth
              size="lg"
              icon={<Plus className="size-4" strokeWidth={2.6} />}
              onClick={() => setPlanSheetOpen(true)}
            >
              Plan your first date
            </Button>
            <p className="mt-2 text-center text-[11.5px] text-[var(--text-faint)]">
              Get a nudge 15 minutes before it starts.
            </p>
          </section>
        )}
      </div>

      <PlanSheet
        open={planSheetOpen}
        onClose={() => {
          setPlanSheetOpen(false);
          setEditingPlan(null);
        }}
        groupId={groupId}
        plan={editingPlan}
        onSaved={() => void loadPlans()}
      />

      <LoveNotesSheet
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        groupId={groupId}
        notes={notes}
        profiles={profiles}
        partner={partner}
        onCreated={() => void loadNotes()}
      />

      <GamesSheet
        open={gamesOpen}
        onClose={() => setGamesOpen(false)}
        groupId={groupId}
        partner={partner}
      />
    </main>
  );
}
