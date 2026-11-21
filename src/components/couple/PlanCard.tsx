"use client";

import { CalendarHeart, Check, Clock, MapPin, PartyPopper } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/utils";
import type { Plan } from "@/types/chat";

const CATEGORY_EMOJI: Record<Plan["category"], string> = {
  date: "💞",
  trip: "✈️",
  call: "📞",
  movie: "🍿",
  game: "🎮",
  other: "✨",
};

export function PlanCard({
  plan,
  compact = false,
  onClick,
  onToggleComplete,
}: {
  plan: Plan;
  compact?: boolean;
  onClick?: () => void;
  onToggleComplete?: () => void;
}) {
  const startsAt = new Date(plan.starts_at);
  // "now" lives in state so render stays pure and the card updates on a timer
  // instead of reading the clock mid-render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const isPast = startsAt.getTime() < now;
  const soon = !isPast && startsAt.getTime() - now < 60 * 60 * 1000 && !plan.completed;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="press flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-left"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--panel-2)] text-[16px]">
          {CATEGORY_EMOJI[plan.category]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-[var(--text)]">
            {plan.title}
          </span>
          <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
            {startsAt.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </span>
        {soon && (
          <span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10.5px] font-bold text-[var(--accent)]">
            in {formatCountdown(plan.starts_at)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={`rounded-3xl border p-4 transition ${
        plan.completed
          ? "border-[var(--border)] bg-[var(--panel)]/50 opacity-65"
          : soon
            ? "border-[var(--accent)]/40 bg-gradient-to-br from-[var(--accent)]/14 to-transparent"
            : "border-[var(--border)] bg-[var(--panel)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--panel-2)] text-[18px]">
          {CATEGORY_EMOJI[plan.category]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-[var(--text)]">
            {plan.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1">
              <CalendarHeart className="size-3" strokeWidth={2.2} />
              {startsAt.toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {plan.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" strokeWidth={2.2} />
                {plan.location}
              </span>
            )}
            {plan.duration_minutes && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" strokeWidth={2.2} />
                {plan.duration_minutes}m
              </span>
            )}
          </p>
          {plan.notes && (
            <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--text-muted)]">
              {plan.notes}
            </p>
          )}
        </div>
        {onToggleComplete && (
          <button
            type="button"
            onClick={onToggleComplete}
            aria-label={plan.completed ? "Completed" : "Mark complete"}
            className={`press grid size-8 shrink-0 place-items-center rounded-full border ${
              plan.completed
                ? "border-[var(--success)]/40 bg-[var(--success)]/15 text-[var(--success)]"
                : "border-[var(--border-strong)] text-[var(--text-faint)]"
            }`}
          >
            {plan.completed ? (
              <PartyPopper className="size-4" strokeWidth={2.2} />
            ) : (
              <Check className="size-4" strokeWidth={2.6} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
