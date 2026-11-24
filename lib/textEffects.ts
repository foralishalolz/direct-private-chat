/** iOS-style text effects. Effects are stored as a strict enum, never as CSS. */
export const TEXT_EFFECTS = [
  { id: "normal", label: "Normal", glyph: "Aa", aria: "Normal text", hint: "No effect" },
  { id: "big", label: "Big", glyph: "Aa", aria: "Big text effect", hint: "Make it loud" },
  { id: "small", label: "Small", glyph: "Aa", aria: "Small text effect", hint: "Whisper it" },
  { id: "shake", label: "Shake", glyph: "↯", aria: "Shake text effect", hint: "A little wobble" },
  { id: "ripple", label: "Ripple", glyph: "◌", aria: "Ripple text effect", hint: "Soft waves" },
  { id: "bloom", label: "Bloom", glyph: "✦", aria: "Bloom text effect", hint: "Warm glow" },
  { id: "explode", label: "Explode", glyph: "✺", aria: "Explode text effect", hint: "Tiny celebration" },
] as const;

export type TextEffect = (typeof TEXT_EFFECTS)[number]["id"];

const VALUES = new Set<string>(TEXT_EFFECTS.map(effect => effect.id));

/** Unknown or normal values become null, so a stale client cannot inject a class. */
export function normalizeTextEffect(value: unknown): Exclude<TextEffect, "normal"> | null {
  if (typeof value !== "string" || !VALUES.has(value) || value === "normal") return null;
  return value as Exclude<TextEffect, "normal">;
}

export function textEffectLabel(value: unknown): string {
  const effect = typeof value === "string" && VALUES.has(value) ? value : "normal";
  return TEXT_EFFECTS.find(item => item.id === effect)?.label ?? "Normal";
}
