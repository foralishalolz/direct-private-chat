"use client";

import { Heart, Send, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Misc";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/hooks/useChatStore";
import { LOVE_PROMPTS } from "@/lib/stickers";
import { playSparkle } from "@/lib/sound";
import { displayName, timeAgo, vibrate } from "@/lib/utils";
import type { LoveNote, Profile } from "@/types/chat";

interface LoveNotesSheetProps {
  open: boolean;
  onClose: () => void;
  groupId: string | null;
  notes: LoveNote[];
  profiles: Record<string, Profile>;
  partner: Profile | null;
  onCreated: () => void;
}

export function LoveNotesSheet({
  open,
  onClose,
  groupId,
  notes,
  profiles,
  partner,
  onCreated,
}: LoveNotesSheetProps) {
  const { user } = useChatStore();
  const [body, setBody] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBody("");
    setPrompt(null);
    setError(null);
  }, [open]);

  async function send() {
    if (!supabase || !groupId || !user || busy) return;
    if (!body.trim()) return;

    setBusy(true);
    setError(null);

    const { error: insertError } = await supabase.from("love_notes").insert({
      group_id: groupId,
      user_id: user.id,
      prompt,
      body: body.trim(),
    });

    setBusy(false);

    if (insertError) {
      setError("Couldn't leave that note. Try again.");
      return;
    }

    setBody("");
    setPrompt(null);
    if (localStorage.getItem("bitchat-sounds") !== "off") playSparkle();
    vibrate([10, 30, 10]);
    onCreated();
  }

  async function remove(id: string) {
    if (!supabase) return;
    await supabase.from("love_notes").delete().eq("id", id);
    onCreated();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Love notes"
      description={`Little things only ${partner ? displayName(partner) : "they"} will read.`}
    >
      <div className="space-y-4">
        <div className="rounded-3xl border border-[var(--accent)]/25 bg-gradient-to-br from-[var(--accent)]/12 to-transparent p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
            <Sparkles className="size-3.5" strokeWidth={2.6} />
            Today&apos;s prompt
          </div>
          <div className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-1">
            {LOVE_PROMPTS.slice(0, 6).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPrompt((current) => (current === option ? null : option))}
                className={`press shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition ${
                  prompt === option
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/20 text-[var(--text)]"
                    : "border-[var(--border-strong)] text-[var(--text-muted)]"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              prompt
                ? `${prompt.replace(/…$/, "")} —`
                : "Write it out. Nobody else will ever see this."
            }
            className="mt-2.5 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/70 px-3.5 py-3 text-[14px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]/70"
          />

          {error && (
            <p className="mt-2 text-[12px] font-medium text-[var(--danger)]">{error}</p>
          )}

          <Button
            fullWidth
            className="mt-2.5"
            loading={busy}
            disabled={!body.trim()}
            onClick={() => void send()}
            icon={<Send className="size-4" strokeWidth={2.2} />}
          >
            Leave the note
          </Button>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
            <Heart className="size-3.5 fill-current" strokeWidth={0} />
            Kept between you
          </p>

          {notes.length === 0 ? (
            <p className="rounded-2xl bg-[var(--panel)] px-3.5 py-4 text-center text-[12.5px] text-[var(--text-muted)]">
              No notes yet. Be the first to say something soft.
            </p>
          ) : (
            <ul className="thin-scrollbar max-h-[36dvh] space-y-2 overflow-y-auto">
              {notes.map((note) => {
                const author = profiles[note.user_id];
                const mine = note.user_id === user?.id;

                return (
                  <li
                    key={note.id}
                    className={`rounded-2xl border p-3 ${
                      mine
                        ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.07]"
                        : "border-[var(--border)] bg-[var(--panel)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar
                        name={displayName(author)}
                        seed={note.user_id}
                        src={author?.avatar_url}
                        accent={author?.accent}
                        size={26}
                      />
                      <span className="text-[11.5px] font-bold text-[var(--text-soft)]">
                        {mine ? "You" : displayName(author)}
                      </span>
                      <span className="text-[10.5px] text-[var(--text-faint)]">
                        {timeAgo(note.created_at)}
                      </span>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => void remove(note.id)}
                          aria-label="Delete note"
                          className="press ml-auto grid size-6 place-items-center rounded-full text-[var(--text-faint)] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="size-3.5" strokeWidth={2.2} />
                        </button>
                      )}
                    </div>
                    {note.prompt && (
                      <p className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--accent)]/70">
                        {note.prompt}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-soft)]">
                      {note.body}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {busy && (
          <div className="grid place-items-center">
            <Spinner className="size-4" />
          </div>
        )}
      </div>
    </Sheet>
  );
}
