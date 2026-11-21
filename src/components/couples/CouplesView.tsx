"use client";

import {
  ArrowLeft,
  Cat,
  ChevronRight,
  Crown,
  Heart,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { TicTacToe, type CoupleMemberWithProfile } from "@/components/couples/TicTacToe";
import { Avatar } from "@/components/Avatar";
import { supabase } from "@/lib/supabase";
import type { Couple, CoupleCuteRole, CoupleMember, Plan, Profile } from "@/types/chat";

type CoupleRow = {
  couple: Couple;
  members: CoupleMemberWithProfile[];
  nextPlan: Plan | null;
};

interface CouplesViewProps {
  user: User;
  profile: Profile | null;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/@chat\.local$/i, "");
}

function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatPlanDate(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = sameDay(d, today)
    ? "Today"
    : sameDay(d, tomorrow)
      ? "Tomorrow"
      : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return { day, time };
}

function roleIcon(role: CoupleCuteRole) {
  return role === "kitten" ? <Cat aria-hidden="true" className="size-4" strokeWidth={2} /> : <Crown aria-hidden="true" className="size-4" strokeWidth={2} />;
}

function roleLabel(role: CoupleCuteRole) {
  return role === "kitten" ? "Kitten" : "Daddy";
}

export function CouplesView({ user, profile }: CouplesViewProps) {
  const client = supabase;
  const myUsername = profile?.username ?? user.email?.split("@")[0] ?? "";

  const [couples, setCouples] = useState<CoupleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCoupleId, setSelectedCoupleId] = useState<string | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoadedId, setPlansLoadedId] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [partnerUsername, setPartnerUsername] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [planTitle, setPlanTitle] = useState("");
  const [planDateTime, setPlanDateTime] = useState(defaultDateTime());
  const [planLocation, setPlanLocation] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [missState, setMissState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const fetchCouples = useCallback(async (): Promise<CoupleRow[]> => {
    if (!client) return [];

    const { data: memberships } = await client
      .from("couple_members")
      .select("couple_id, user_id, cute_role, since")
      .eq("user_id", user.id);

    const rows = (memberships ?? []) as CoupleMember[];
    const coupleIds = Array.from(new Set(rows.map((r) => r.couple_id)));

    if (coupleIds.length === 0) return [];

    const { data: coupleRows } = await client
      .from("couples")
      .select("id, name, created_by, created_at")
      .in("id", coupleIds)
      .order("created_at", { ascending: true });

    const { data: allMembers } = await client
      .from("couple_members")
      .select("couple_id, user_id, cute_role, since")
      .in("couple_id", coupleIds);

    const userIds = Array.from(
      new Set(((allMembers ?? []) as CoupleMember[]).map((m) => m.user_id)),
    );

    const { data: profileRows } = await client
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    const usernameById = new Map(
      (profileRows ?? []).map((p) => [p.id as string, p.username as string]),
    );

    const membersByCouple = new Map<string, CoupleMemberWithProfile[]>();
    for (const member of (allMembers ?? []) as CoupleMember[]) {
      const list = membersByCouple.get(member.couple_id) ?? [];
      list.push({ ...member, username: usernameById.get(member.user_id) ?? "someone" });
      membersByCouple.set(member.couple_id, list);
    }

    // Next upcoming plan per couple
    const { data: planRows } = await client
      .from("plans")
      .select("id, couple_id, title, starts_at, ends_at, location, notes, created_by, done, created_at")
      .in("couple_id", coupleIds)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true });

    const nextPlanByCouple = new Map<string, Plan>();
    for (const plan of (planRows ?? []) as Plan[]) {
      if (!nextPlanByCouple.has(plan.couple_id)) nextPlanByCouple.set(plan.couple_id, plan);
    }

    return ((coupleRows ?? []) as Couple[]).map((couple) => ({
      couple,
      members: membersByCouple.get(couple.id) ?? [],
      nextPlan: nextPlanByCouple.get(couple.id) ?? null,
    }));
  }, [client, user.id]);

  const refreshCouples = useCallback(async () => {
    const next = await fetchCouples();
    setCouples(next);
    setIsLoading(false);
  }, [fetchCouples]);

  useEffect(() => {
    let active = true;

    (async () => {
      const next = await fetchCouples();
      if (!active) return;
      setCouples(next);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [fetchCouples]);

  // Refresh live
  useEffect(() => {
    if (!client) return;

    const channel = client
      .channel("couples-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "couples" },
        () => void refreshCouples(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "couple_members" },
        () => void refreshCouples(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plans" },
        () => void refreshCouples(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [client, refreshCouples]);

  const selectedRow = couples.find((row) => row.couple.id === selectedCoupleId) ?? null;
  const plansLoading = Boolean(selectedCoupleId) && plansLoadedId !== selectedCoupleId;

  const fetchPlans = useCallback(
    async (coupleId: string): Promise<Plan[]> => {
      if (!client) return [];
      const { data } = await client
        .from("plans")
        .select("id, couple_id, title, starts_at, ends_at, location, notes, created_by, done, created_at")
        .eq("couple_id", coupleId)
        .order("starts_at", { ascending: true });
      return (data ?? []) as Plan[];
    },
    [client],
  );

  const refreshPlans = useCallback(
    async (coupleId: string) => {
      const next = await fetchPlans(coupleId);
      setPlans(next);
      setPlansLoadedId(coupleId);
    },
    [fetchPlans],
  );

  useEffect(() => {
    if (!selectedCoupleId) return;

    let active = true;

    (async () => {
      const next = await fetchPlans(selectedCoupleId);
      if (!active) return;
      setPlans(next);
      setPlansLoadedId(selectedCoupleId);
    })();

    if (!client) return;
    const channel = client
      .channel(`plans-${selectedCoupleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plans", filter: `couple_id=eq.${selectedCoupleId}` },
        () => void refreshPlans(selectedCoupleId),
      )
      .subscribe();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [selectedCoupleId, client, fetchPlans, refreshPlans]);

  async function handleCreateCouple(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    setCreateError(null);

    const username = normalizeUsername(partnerUsername);
    if (!username) {
      setCreateError("Enter your partner's username.");
      return;
    }

    setIsCreating(true);

    if (!client) {
      setIsCreating(false);
      return;
    }

    const {
      data: { session },
    } = await client.auth.getSession();

    if (!session?.access_token) {
      setIsCreating(false);
      setCreateError("You need to be signed in.");
      return;
    }

    const response = await fetch("/api/couples", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ partnerUsername: username }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string; couple?: Couple };

    setIsCreating(false);

    if (!response.ok) {
      setCreateError(payload.error ?? "Could not create the couple.");
      return;
    }

    setPartnerUsername("");
    setSheetOpen(false);
    await refreshCouples();
    if (payload.couple?.id) setSelectedCoupleId(payload.couple.id);
  }

  async function toggleCuteRole(member: CoupleMemberWithProfile) {
    if (!client || member.user_id !== user.id) return;
    const next: CoupleCuteRole = member.cute_role === "kitten" ? "daddy" : "kitten";
    const { error } = await client
      .from("couple_members")
      .update({ cute_role: next })
      .eq("couple_id", member.couple_id)
      .eq("user_id", member.user_id);
    if (!error) await refreshCouples();
  }

  async function handleMissYou() {
    if (!client || !selectedRow || missState === "sending") return;
    setMissState("sending");

    const other = selectedRow.members.find((m) => m.user_id !== user.id);
    if (!other) {
      setMissState("error");
      return;
    }

    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.access_token) {
      setMissState("error");
      return;
    }

    try {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          type: "miss",
          recipientUserId: other.user_id,
          senderName: myUsername,
        }),
      });

      if (!response.ok) {
        setMissState("error");
        return;
      }

      setMissState("sent");
      window.setTimeout(() => setMissState("idle"), 2800);
    } catch {
      setMissState("error");
    }
  }

  async function handleSavePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !selectedRow || planSaving) return;

    const title = planTitle.trim();
    if (!title) {
      setPlanError("Give the plan a title.");
      return;
    }
    if (!planDateTime) {
      setPlanError("Pick a date and time.");
      return;
    }

    setPlanSaving(true);
    setPlanError(null);

    const startsAt = new Date(planDateTime);
    if (Number.isNaN(startsAt.getTime())) {
      setPlanError("That date doesn't look right.");
      setPlanSaving(false);
      return;
    }

    const { error } = await client.from("plans").insert({
      couple_id: selectedRow.couple.id,
      title: title.slice(0, 120),
      starts_at: startsAt.toISOString(),
      location: planLocation.trim() || null,
      notes: planNotes.trim() || null,
      created_by: user.id,
    });

    setPlanSaving(false);

    if (error) {
      setPlanError("Could not save the plan. Try again.");
      return;
    }

    setPlanTitle("");
    setPlanLocation("");
    setPlanNotes("");
    setPlanDateTime(defaultDateTime());
    setSheetOpen(false);
    await refreshPlans(selectedRow.couple.id);
    await refreshCouples();
  }

  async function togglePlanDone(plan: Plan) {
    if (!client) return;
    await client.from("plans").update({ done: !plan.done }).eq("id", plan.id);
    await refreshPlans(plan.couple_id);
  }

  async function deletePlan(plan: Plan) {
    if (!client) return;
    await client.from("plans").delete().eq("id", plan.id);
    await refreshPlans(plan.couple_id);
    await refreshCouples();
  }

  async function handleEndCouple() {
    if (!client || !selectedRow) return;
    if (!window.confirm("End this couple? Plans and games will be deleted too.")) return;
    await client.from("couples").delete().eq("id", selectedRow.couple.id);
    setSelectedCoupleId(null);
    await refreshCouples();
  }

  const myMark = useMemo(() => {
    if (!selectedRow) return "x";
    const sorted = [...selectedRow.members].sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime());
    const first = sorted[0];
    return first?.user_id === user.id ? "x" : "o";
  }, [selectedRow, user.id]);

  /* ── Detail view ───────────────────────────────────────────────── */
  if (selectedRow) {
    const partner = selectedRow.members.find((m) => m.user_id !== user.id);
    const myMembership = selectedRow.members.find((m) => m.user_id === user.id);

    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          <button
            type="button"
            onClick={() => setSelectedCoupleId(null)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-full text-[14px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]"
          >
            <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={2} />
            All couples
          </button>

          {/* Kitten & Daddy header */}
          <div className="mb-5 rounded-3xl border border-[var(--border-strong)] bg-[var(--grad-soft)] p-4 backdrop-blur">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-text)]">
              Kitten &amp; Daddy
            </p>
            <div className="grid grid-cols-2 gap-3">
              {selectedRow.members.map((member) => {
                const isMine = member.user_id === user.id;
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    onClick={() => void toggleCuteRole(member)}
                    disabled={!isMine}
                    title={isMine ? "Tap to switch your vibe" : "Your partner's vibe"}
                    className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/70 p-3 text-left transition enabled:hover:border-[var(--border-strong)]"
                  >
                    <Avatar seed={member.user_id} name={member.username ?? "?"} className="size-10" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold leading-tight">
                        {member.username ?? "someone"}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
                        {roleIcon(member.cute_role)}
                        {roleLabel(member.cute_role)}
                        {isMine && <span className="ml-0.5 opacity-50">· tap to switch</span>}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Miss you */}
          <button
            type="button"
            onClick={() => void handleMissYou()}
            disabled={missState === "sending" || !partner}
            className="btn-accent mb-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold"
          >
            {missState === "sending" ? (
              <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={2} />
            ) : missState === "sent" ? (
              <span className="inline-flex items-center gap-2 animate-clap-heart">
                <Heart aria-hidden="true" className="size-5 fill-current" strokeWidth={1.6} />
                Sent — {partner?.username ?? "your partner"} got the message!
              </span>
            ) : (
              <>
                <Heart aria-hidden="true" className="size-5" strokeWidth={2} />
                {missState === "error" ? "Couldn't send — try again" : "I miss you ❤️"}
              </>
            )}
          </button>

          {/* Plans */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Dates &amp; plans</h2>
            <button
              type="button"
              onClick={() => {
                setPlanError(null);
                setSheetOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)]"
            >
              <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
              Add plan
            </button>
          </div>

          {plansLoading ? (
            <div className="mb-6 grid place-items-center py-8">
              <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-[var(--text-muted)]" strokeWidth={1.8} />
            </div>
          ) : plans.length === 0 ? (
            <div className="mb-6 rounded-2xl border border-dashed border-[var(--border-strong)] p-6 text-center">
              <p className="text-[13px] text-[var(--text-muted)]">No plans yet — plan your next date.</p>
            </div>
          ) : (
            <ul className="mb-6 space-y-2">
              {plans.map((plan) => {
                const d = formatPlanDate(plan.starts_at);
                return (
                  <li
                    key={plan.id}
                    className={`flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 ${plan.done ? "opacity-60" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => void togglePlanDone(plan)}
                      aria-label={plan.done ? "Mark plan as not done" : "Mark plan as done"}
                      className={`grid size-8 shrink-0 place-items-center rounded-full border text-[13px] font-bold transition ${
                        plan.done
                          ? "border-[var(--success)] bg-[var(--success)] text-[var(--bg)]"
                          : "border-[var(--border-strong)] text-transparent hover:border-[var(--accent-text)]"
                      }`}
                    >
                      {plan.done ? "✓" : ""}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[14px] font-semibold ${plan.done ? "line-through" : ""}`}>
                        {plan.title}
                      </p>
                      <p className="truncate text-[12px] text-[var(--text-muted)]">
                        {d.day} · {d.time}
                        {plan.location ? ` · ${plan.location}` : ""}
                      </p>
                      {plan.notes && (
                        <p className="truncate text-[11px] text-[var(--text-faint)]">{plan.notes}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void deletePlan(plan)}
                      aria-label="Delete plan"
                      className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                    >
                      <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Game */}
          <div className="mb-6 rounded-3xl border border-[var(--border-strong)] bg-[var(--panel)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">Tic-Tac-Toe</h2>
                <p className="text-[12px] text-[var(--text-muted)]">
                  vs {partner?.username ?? "your partner"} · turn-based
                </p>
              </div>
            </div>
            <TicTacToe
              coupleId={selectedRow.couple.id}
              coupleMembers={selectedRow.members}
              currentUserId={user.id}
              currentUserMark={myMark as "x" | "o"}
            />
          </div>

          {/* Danger zone */}
          <button
            type="button"
            onClick={() => void handleEndCouple()}
            className="mb-8 text-[12px] font-medium text-[var(--text-faint)] transition hover:text-[var(--danger)]"
          >
            End this couple
          </button>
        </div>

        {/* Add plan sheet */}
        {sheetOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
            <form
              onSubmit={handleSavePlan}
              className="glass w-full max-w-xl rounded-t-3xl border border-[var(--border-strong)] p-5 sm:rounded-3xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[16px] font-semibold">New date</h3>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close"
                  className="grid size-9 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--hover)]"
                >
                  <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
                </button>
              </div>

              <div className="space-y-3">
                <input
                  value={planTitle}
                  onChange={(event) => setPlanTitle(event.target.value)}
                  placeholder="Plan title — e.g. Brunch at the marina"
                  maxLength={120}
                  autoFocus
                  className="input"
                  aria-label="Plan title"
                />
                <input
                  type="datetime-local"
                  value={planDateTime}
                  onChange={(event) => setPlanDateTime(event.target.value)}
                  className="input [color-scheme:dark]"
                  aria-label="Plan date and time"
                />
                <input
                  value={planLocation}
                  onChange={(event) => setPlanLocation(event.target.value)}
                  placeholder="Location (optional)"
                  maxLength={120}
                  className="input"
                  aria-label="Location"
                />
                <textarea
                  value={planNotes}
                  onChange={(event) => setPlanNotes(event.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  maxLength={400}
                  className="input resize-none"
                  aria-label="Notes"
                />
              </div>

              {planError && <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--danger)]">{planError}</p>}

              <button
                type="submit"
                disabled={planSaving || !planTitle.trim()}
                className="btn-accent mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-semibold"
              >
                {planSaving ? (
                  <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={1.8} />
                ) : (
                  "Save plan"
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  /* ── List view ─────────────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">Couples</h1>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
              Kitten &amp; Daddy · plans · games
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Create a couple"
            className="btn-accent grid size-11 place-items-center rounded-full"
          >
            <Plus aria-hidden="true" className="size-5" strokeWidth={2.2} />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2.5">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton h-20 rounded-2xl" />
            ))}
          </div>
        ) : couples.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-4 px-6 text-center">
            <span
              aria-hidden="true"
              className="grid size-20 place-items-center rounded-[26px] text-white"
              style={{ background: "var(--grad-accent)" }}
            >
              <Heart aria-hidden="true" className="size-9" strokeWidth={1.8} />
            </span>
            <div>
              <p className="text-[16px] font-semibold">Start a couple</p>
              <p className="mt-1 max-w-[32ch] text-sm text-[var(--text-muted)]">
                Link with your partner, plan dates together and even play a game.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="btn-accent inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold"
            >
              <Plus aria-hidden="true" className="size-4" strokeWidth={2.2} />
              Find your partner
            </button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {couples.map((row) => {
              const partner = row.members.find((m) => m.user_id !== user.id);
              const next = row.nextPlan;
              return (
                <li key={row.couple.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedCoupleId(row.couple.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3.5 text-left transition hover:border-[var(--border-strong)] active:scale-[0.99]"
                  >
                    <div className="flex shrink-0">
                      {row.members.map((member, index) => (
                        <span
                          key={member.user_id}
                          className={`grid size-11 place-items-center rounded-full ring-2 ring-[var(--panel)] ${index === 0 ? "z-10" : "-ml-4 z-0"}`}
                        >
                          <Avatar seed={member.user_id} name={member.username ?? "?"} className="size-11" />
                        </span>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">
                        {myUsername} &amp; {partner?.username ?? "…"}
                      </p>
                      <p className="truncate text-[12px] text-[var(--text-muted)]">
                        {next ? `Next: ${next.title} · ${formatPlanDate(next.starts_at).day}` : "No upcoming plans"}
                      </p>
                    </div>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-[var(--text-faint)]" strokeWidth={2} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Create-couple sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={handleCreateCouple}
            className="glass w-full max-w-md rounded-t-3xl border border-[var(--border-strong)] p-5 sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold">Find your partner</h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="grid size-9 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--hover)]"
              >
                <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
              </button>
            </div>

            <p className="mb-3 text-[13px] text-[var(--text-muted)]">
              Enter your partner&apos;s username. You&apos;ll both see plans, games and misses.
            </p>

            <input
              value={partnerUsername}
              onChange={(event) => setPartnerUsername(event.target.value)}
              placeholder="Partner username"
              aria-label="Partner username"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input"
            />

            {createError && (
              <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--danger)]">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={isCreating || !partnerUsername.trim()}
              className="btn-accent mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-semibold"
            >
              {isCreating ? (
                <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={1.8} />
              ) : (
                "Create couple"
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
