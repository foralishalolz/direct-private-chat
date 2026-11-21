export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const RELATIVE_STEPS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.34524, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
  style: "short",
});

export function timeAgo(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  const diffSeconds = (date.getTime() - Date.now()) / 1000;

  let value = diffSeconds;
  for (const [amount, unit] of RELATIVE_STEPS) {
    if (Math.abs(value) < amount) {
      return relativeFormatter.format(Math.round(value), unit);
    }
    value /= amount;
  }
  return "";
}

export function formatTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDayLabel(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  const withinWeek = Date.now() - date.getTime() < 6 * 24 * 60 * 60 * 1000;
  if (withinWeek) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function formatCountdown(input: string | number | Date): string {
  const target = new Date(input).getTime();
  const diff = target - Date.now();

  if (diff <= 0) return "now";

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d${remainingHours ? ` ${remainingHours}h` : ""}`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ""}`;
  }
  return `${Math.max(1, minutes)}m`;
}

export function formatDayAndTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  const cleaned = name.replace(/[_.-]+/g, " ").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function displayName(profile?: {
  display_name?: string | null;
  username?: string | null;
} | null): string {
  if (!profile) return "Someone";
  return profile.display_name?.trim() || profile.username || "Someone";
}

/** Deterministic pastel gradient for an avatar, seeded by any string id. */
export function avatarGradient(seed: string, accent?: string | null): string {
  if (accent) return accent;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const hue = hash;
  return `linear-gradient(140deg, hsl(${hue} 78% 62%), hsl(${(hue + 48) % 360} 70% 52%))`;
}

export function isOnline(lastSeenAt?: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 70_000;
}

export function lastSeenLabel(lastSeenAt?: string | null): string {
  if (!lastSeenAt) return "Offline";
  if (isOnline(lastSeenAt)) return "Active now";
  return `Active ${timeAgo(lastSeenAt)}`;
}

export function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function previewForMessage(message: {
  content?: string | null;
  kind?: string | null;
  deleted_at?: string | null;
}): string {
  if (message.deleted_at) return "Message deleted";
  const text = message.content?.trim();
  switch (message.kind) {
    case "image":
      return text ? `📷 ${text}` : "📷 Photo";
    case "video":
      return text ? `🎥 ${text}` : "🎥 Video";
    case "audio":
      return "🎙 Voice note";
    case "sticker":
      return text || "💗 Sticker";
    default:
      return text || "";
  }
}

/** True on iOS/iPadOS so we can render install instructions. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" &&
      (navigator as Navigator & { maxTouchPoints: number }).maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function safeRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function vibrate(pattern: number | number[] = 8) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
