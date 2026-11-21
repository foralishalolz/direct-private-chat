"use client";

import { CalendarHeart, Check, Clock, MapPin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/hooks/useChatStore";
import { playSparkle } from "@/lib/sound";
import { vibrate } from "@/lib/utils";
import type { Plan, PlanCategory } from "@/types/chat";

const CATEGORIES: Array<{ value: PlanCategory; label: string; emoji: string }> = [
  { value: "date", label: "Date", emoji: "💞" },
  { value: "call", label: "Call", emoji: "📞" },
  { value: "movie", label: "Movie", emoji: "🍿" },
  { value: "trip", label: "Trip", emoji: "✈️" },
  { value: "game", label: "Game night", emoji: "🎮" },
  { value: "other", label: "Other", emoji: "✨" },
];

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(19, 0, 0, 0);
  return toLocalInput(date);
}

interface PlanSheetProps {
  open: boolean;
  onClose: () => void;
  groupId: string | null;
  plan: Plan | null;
  onSaved: () => void;
}

export function PlanSheet({ open, onClose, groupId, plan, onSaved }: PlanSheetProps) {
  const { user } = useChatStore();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<PlanCategory>("date");
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (plan) {
      setTitle(plan.title);
      setNotes(plan.notes ?? "");
      setCategory(plan.category);
      setStartsAt(toLocalInput(new Date(plan.starts_at)));
      setDuration(plan.duration_minutes ? String(plan.duration_minutes) : "");
      setLocation(plan.location ?? "");
    } else {
      setTitle("");
      setNotes("");
      setCategory("date");
      setStartsAt(defaultStart());
      setDuration("60");
      setLocation("");
    }
    setError(null);
  }, [open, plan]);

  async function save() {
    if (!supabase || !groupId || !user || busy) return;

    if (!title.trim()) {
      setError("Give your plan a name.");
      return;
    }
    if (!startsAt) {
      setError("Pick a date and time.");
      return;
    }

    setBusy(true);
    setError(null);

    const payload = {
      group_id: groupId,
      title: title.trim(),
      notes: notes.trim() || null,
      category,
      starts_at: new Date(startsAt).toISOString(),
      duration_minutes: duration ? Number(duration) : null,
      location: location.trim() || null,
    };

    const { error: saveError } = plan
      ? await supabase.from("plans").update(payload).eq("id", plan.id)
      : await supabase.from("plans").insert({ ...payload, created_by: user.id });

    setBusy(false);

    if (saveError) {
      setError("Couldn't save that plan. Try again.");
      return;
    }

    if (localStorage.getItem("bitchat-sounds") !== "off") playSparkle();
    vibrate(12);
    onSaved();
    onClose();
  }

  async function remove() {
    if (!supabase || !plan) return;
    if (!confirm("Delete this plan?")) return;
    setBusy(true);
    await supabase.from("plans").delete().eq("id", plan.id);
    setBusy(false);
    onSaved();
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={plan ? "Edit plan" : "Plan something"}
      description="Dates, calls and movie nights — with a reminder before it starts."
    >
      <div className="space-y-4">
        <Input
          label="What are we doing?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Late night walk & boba"
          maxLength={80}
          icon={<CalendarHeart className="size-4" strokeWidth={2} />}
        />

        <div>
          <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            Type
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {CATEGORIES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCategory(option.value)}
                className={`press flex items-center justify-center gap-1.5 rounded-xl border py-2 text-[12.5px] font-semibold transition ${
                  category === option.value
                    ? "border-[var(--accent)]/60 bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--panel)] text-[var(--text-soft)]"
                }`}
              >
                <span>{option.emoji}</span>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            When
          </span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 text-[14px] text-[var(--text)] outline-none focus:border-[var(--accent)]/70"
            style={{ colorScheme: "dark" }}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Minutes"
            type="number"
            min={5}
            max={1440}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            placeholder="60"
            icon={<Clock className="size-4" strokeWidth={2} />}
          />
          <Input
            label="Where"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Optional"
            maxLength={80}
            icon={<MapPin className="size-4" strokeWidth={2} />}
          />
        </div>

        <Textarea
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Little details, outfit ideas, playlist…"
          maxLength={500}
        />

        {error && (
          <p className="rounded-xl bg-[var(--danger)]/10 px-3 py-2 text-[12.5px] font-medium text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            fullWidth
            loading={busy}
            onClick={() => void save()}
            icon={<Check className="size-4" strokeWidth={3} />}
          >
            {plan ? "Save changes" : "Add to our calendar"}
          </Button>

          {plan && (
            <Button
              variant="danger"
              size="icon"
              onClick={() => void remove()}
              aria-label="Delete plan"
            >
              <Trash2 className="size-4" strokeWidth={2.2} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
