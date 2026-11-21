const GRADIENTS = [
  "linear-gradient(135deg, #ff9a5a 0%, #ff5f6d 40%, #c13584 75%, #8b3fe0 100%)",
  "linear-gradient(135deg, #34d399 0%, #10b981 40%, #0d9488 100%)",
  "linear-gradient(135deg, #60a5fa 0%, #3b82f6 45%, #6366f1 100%)",
  "linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #ea580c 100%)",
  "linear-gradient(135deg, #f472b6 0%, #ec4899 45%, #a855f7 100%)",
  "linear-gradient(135deg, #2dd4bf 0%, #14b8a6 45%, #0ea5e9 100%)",
  "linear-gradient(135deg, #a78bfa 0%, #8b5cf6 45%, #d946ef 100%)",
  "linear-gradient(135deg, #fb7185 0%, #f43f5e 45%, #e11d48 100%)",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function avatarGradient(seed: string): string {
  return GRADIENTS[hashString(seed) % GRADIENTS.length];
}

interface AvatarProps {
  seed: string;
  name: string;
  className?: string;
  textClassName?: string;
}

/** Gradient circle avatar with the user's initial — no photos, works everywhere. */
export function Avatar({ seed, name, className = "size-10", textClassName = "text-sm" }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{ background: avatarGradient(seed) }}
    >
      <span className={textClassName}>{name.charAt(0).toUpperCase() || "?"}</span>
    </span>
  );
}

/** Group avatar — same gradient language, with a # glyph for groups. */
export function GroupAvatar({
  seed,
  name,
  className = "size-11",
}: {
  seed: string;
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-2xl font-semibold text-white ${className}`}
      style={{ background: avatarGradient(seed) }}
    >
      <span className="text-base">{name.charAt(0).toUpperCase() || "#"}</span>
    </span>
  );
}
