"use client";

import {
  Cat,
  Check,
  Crown,
  Download,
  Heart,
  LogOut,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Misc";
import { useChatStore } from "@/hooks/useChatStore";
import { supabase } from "@/lib/supabase";
import { uploadMedia } from "@/lib/media";
import { displayName, isIos, isStandalone } from "@/lib/utils";
import type { CoupleRole } from "@/types/chat";

const ACCENTS = [
  "linear-gradient(140deg,#fb7185,#a855f7)",
  "linear-gradient(140deg,#f472b6,#fbbf24)",
  "linear-gradient(140deg,#60a5fa,#a855f7)",
  "linear-gradient(140deg,#34d399,#0ea5e9)",
  "linear-gradient(140deg,#f97316,#ec4899)",
  "linear-gradient(140deg,#a3e635,#22d3ee)",
];

export function ProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { profile, user, updateProfile, signOut, groups } = useChatStore();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [accent, setAccent] = useState<string | null>(null);
  const [coupleRole, setCoupleRole] = useState<CoupleRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installHint, setInstallHint] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile?.display_name ?? profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setAccent(profile?.accent ?? null);
    setCoupleRole(profile?.couple_role ?? null);
    setSaved(false);
    setError(null);
  }, [open, profile]);

  async function save() {
    if (!supabase || !user || busy) return;
    setBusy(true);
    setError(null);

    const patch = {
      display_name: name.trim() || profile?.username,
      bio: bio.trim() || null,
      accent,
      couple_role: coupleRole,
    };

    const { error: updateError } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id);

    setBusy(false);

    if (updateError) {
      setError("Couldn't save those changes. Try again.");
      return;
    }

    updateProfile(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file || !user) return;
    setBusy(true);
    setError(null);

    try {
      const result = await uploadMedia(file, { groupId: "avatars", userId: user.id });
      await supabase
        ?.from("profiles")
        .update({ avatar_url: result.url })
        .eq("id", user.id);
      updateProfile({ avatar_url: result.url });
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = profile?.role === "admin";
  const directCount = groups.filter((group) => group.is_direct).length;

  return (
    <Sheet open={open} onClose={onClose} title="Your profile" description="This is how you show up to your people.">
      <div className="space-y-5">
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="press relative"
            aria-label="Change photo"
          >
            <Avatar
              name={displayName(profile)}
              seed={profile?.id ?? "me"}
              src={profile?.avatar_url}
              accent={accent}
              size={92}
              ring
            />
            <span className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-[var(--bg-elevated)] accent-gradient text-white">
              <Sparkles className="size-3.5" strokeWidth={2.4} />
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void uploadAvatar(event.target.files?.[0])}
          />
          <p className="mt-3 text-[15px] font-bold text-[var(--text)]">
            {displayName(profile)}
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">@{profile?.username}</p>
          <div className="mt-2 flex items-center gap-1.5">
            {isAdmin && (
              <Pill tone="accent">
                <Crown className="size-2.5" strokeWidth={2.6} />
                admin
              </Pill>
            )}
            {coupleRole && (
              <Pill tone={coupleRole === "kitten" ? "accent" : "warning"}>
                {coupleRole === "kitten" ? (
                  <Cat className="size-2.5" strokeWidth={2.6} />
                ) : (
                  <Heart className="size-2.5" strokeWidth={2.6} />
                )}
                {coupleRole}
              </Pill>
            )}
            <Pill>{directCount} private {directCount === 1 ? "chat" : "chats"}</Pill>
          </div>
        </div>

        <div className="space-y-3">
          <Input
            label="Display name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="How should they see you?"
            icon={<UserRound className="size-4" strokeWidth={2} />}
          />

          <label className="block">
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Bio
            </span>
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={160}
              rows={2}
              placeholder="A line about you…"
              className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[14px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]/70"
            />
          </label>

          <div>
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Your colour
            </span>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAccent(option)}
                  aria-label="Pick colour"
                  className={`press grid size-9 place-items-center rounded-full ${
                    accent === option ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-elevated)]" : ""
                  }`}
                  style={{ backgroundImage: option }}
                >
                  {accent === option && (
                    <Check className="size-4 text-white" strokeWidth={3} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Couple role
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    value: "kitten" as CoupleRole,
                    label: "Kitten",
                    emoji: "🐱",
                    blurb: "soft & spoiled",
                  },
                  {
                    value: "dada" as CoupleRole,
                    label: "Dada",
                    emoji: "🫶",
                    blurb: "steady & safe",
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setCoupleRole((current) =>
                      current === option.value ? null : option.value,
                    )
                  }
                  className={`press rounded-2xl border p-3 text-left transition ${
                    coupleRole === option.value
                      ? "border-[var(--accent)]/70 bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-[var(--panel)]"
                  }`}
                >
                  <span className="text-[20px]">{option.emoji}</span>
                  <span className="mt-1 block text-[13.5px] font-bold text-[var(--text)]">
                    {option.label}
                  </span>
                  <span className="block text-[11.5px] text-[var(--text-muted)]">
                    {option.blurb}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-[var(--danger)]/10 px-3 py-2 text-[12.5px] font-medium text-[var(--danger)]">
            {error}
          </p>
        )}

        <Button
          fullWidth
          loading={busy}
          onClick={() => void save()}
          icon={saved ? <Check className="size-4" strokeWidth={3} /> : undefined}
        >
          {saved ? "Saved" : "Save profile"}
        </Button>

        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <Button
            variant="secondary"
            fullWidth
            icon={<Download className="size-4" />}
            onClick={() => setInstallHint((visible) => !visible)}
          >
            Install as an app
          </Button>

          {installHint && (
            <p className="rounded-xl bg-[var(--panel)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
              {isIos()
                ? "Open in Safari → tap Share → “Add to Home Screen” to get BitchAt as a real app icon with notifications."
                : "In Chrome or Edge, open the browser menu and choose “Install app” (or the install icon in the address bar)."}
              {isStandalone() && " You're already running installed. 🎉"}
            </p>
          )}

          {isAdmin && (
            <Link
              href="/admin"
              className="press flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--panel-2)] text-[14px] font-semibold text-[var(--text)]"
            >
              <Crown className="size-4" />
              Admin dashboard
            </Link>
          )}

          <Button
            variant="ghost"
            fullWidth
            icon={<LogOut className="size-4" />}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
