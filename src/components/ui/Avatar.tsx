"use client";

import { avatarGradient, initials } from "@/lib/utils";

interface AvatarProps {
  name?: string | null;
  seed?: string;
  src?: string | null;
  accent?: string | null;
  size?: number;
  /** Outer story ring (Instagram-style). */
  ring?: boolean;
  online?: boolean;
  className?: string;
}

export function Avatar({
  name,
  seed,
  src,
  accent,
  size = 44,
  ring = false,
  online = false,
  className = "",
}: AvatarProps) {
  const label = initials(name);
  const background = avatarGradient(seed || name || "bitchat", accent);
  const fontSize = Math.max(11, Math.round(size * 0.36));

  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      {ring && (
        <span
          aria-hidden="true"
          className="story-ring absolute inset-0 rounded-full opacity-90"
        />
      )}
      <span
        className="relative grid size-full place-items-center overflow-hidden rounded-full font-semibold text-white"
        style={{
          background: src ? "var(--panel-3)" : background,
          padding: ring ? 2.5 : 0,
          fontSize,
          boxShadow: ring ? "inset 0 0 0 2.5px var(--bg)" : undefined,
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full rounded-full object-cover"
          />
        ) : (
          label
        )}
      </span>
      {online && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-[var(--bg)] bg-[var(--success)]"
        />
      )}
    </span>
  );
}
