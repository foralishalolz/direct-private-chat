export type KissMeter = { taps_a: number; taps_b: number; last_at: string };

type Level = { at: number; label: string; glyph: string };
export const KISS_LEVELS: readonly Level[] = [
  { at: 0, label: "Shy", glyph: "🙈" },
  { at: 6, label: "Warming up", glyph: "😚" },
  { at: 20, label: "Butterflies", glyph: "🦋" },
  { at: 50, label: "Smitten", glyph: "🥰" },
  { at: 120, label: "Obsessed", glyph: "😻" },
  { at: 300, label: "Insatiable", glyph: "🔥" },
  { at: 800, label: "Legendary", glyph: "💞" },
];

export function kissLevel(total: number) {
  let level: Level = KISS_LEVELS[0];
  for (const item of KISS_LEVELS) if (total >= item.at) level = item;
  const index = KISS_LEVELS.indexOf(level);
  const next = KISS_LEVELS[index + 1];
  return { ...level, next, progress: next ? Math.min(1, (total - level.at) / (next.at - level.at)) : 1 };
}

/** Tap labels climb with the streak so a burst feels alive. */
const STREAK_WORDS = ["muah", "mwah", "💋", "smooch", "muahh", "smack", "💞", "kiss", "xoxo"];
export const streakWord = (streak: number) => STREAK_WORDS[Math.min(STREAK_WORDS.length - 1, Math.floor(streak / 2))];

/** Heart offsets are deterministic so a re-render never restarts an animation. */
export function heartBurst(index: number) {
  const angle = (index * 137.5) % 360;
  const distance = 60 + ((index * 47) % 90);
  return {
    left: 50 + Math.cos((angle * Math.PI) / 180) * 22,
    drift: Math.cos((angle * Math.PI) / 180) * distance,
    rise: 120 + distance,
    spin: Math.sin((angle * Math.PI) / 180) * 40,
    delay: (index % 5) * 40,
  };
}

/** Each kiss RPC accepts a small burst; callers send the rest in later batches. */
export function kissBatch(queued: number): number {
  return Number.isFinite(queued) ? Math.max(0, Math.min(12, Math.floor(queued))) : 0;
}
