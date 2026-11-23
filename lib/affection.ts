import type { Message } from "./types";

/**
 * One-tap affections. `kind` decides the bubble styling; the caption is what
 * the partner reads. Keep `content` stable — it is how older bubbles are
 * recognised after a reload.
 */
export const AFFECTIONS = [
  { id: "kiss", label: "Kiss", glyph: "💋", caption: "A kiss for you", content: "💋 A kiss for you", kind: "message" },
  { id: "hug", label: "Hug", glyph: "🫂", caption: "A hug for you", content: "🫂 A hug for you", kind: "message" },
  { id: "love", label: "Love", glyph: "💗", caption: "All my love", content: "💗 All my love", kind: "message" },
  { id: "miss", label: "I miss you", glyph: "🤍", caption: "I miss you", content: "🤍 I miss you", kind: "miss" },
  { id: "muah", label: "Muahh", glyph: "💋", caption: "Muahh!", content: "💋 Muahh!", kind: "message" },
  { id: "ask_kiss", label: "Ask for a kiss", glyph: "🥺", caption: "A kiss, please?", content: "🥺 A kiss, please?", kind: "message", response: "muah", responseLabel: "Send a kiss back" },
  { id: "ask_hug", label: "Ask for a hug", glyph: "🧸", caption: "Hold me close?", content: "🧸 Hold me close?", kind: "message", response: "hug", responseLabel: "Send a hug back" },
  { id: "ily", label: "ILY", glyph: "🫶", caption: "ILY", content: "🫶 ILY", kind: "message" },
  { id: "cookie", label: "Cookie", glyph: "🍪", caption: "A cookie for you", content: "🍪 A cookie for you", kind: "message" },
  { id: "strawberry", label: "Strawberry", glyph: "🍓", caption: "Sweet on you", content: "🍓 Sweet on you", kind: "message" },
  { id: "rose", label: "Rose", glyph: "🌹", caption: "A rose for you", content: "🌹 A rose for you", kind: "message" },
  { id: "moon", label: "Goodnight", glyph: "🌙", caption: "Sleep well, dream of me", content: "🌙 Sleep well, dream of me", kind: "message" },
  { id: "snuggle", label: "Snuggle", glyph: "🧸", caption: "Snuggle me", content: "🧸 Snuggle me", kind: "message" },
  { id: "simp", label: "Simp", glyph: "😻", caption: "Obsessed with you", content: "😻 Obsessed with you", kind: "message" },
  { id: "bow", label: "At your feet", glyph: "🙇", caption: "At your feet", content: "🙇 At your feet", kind: "message" },
  { id: "cuddle", label: "Cuddle", glyph: "🫶", caption: "Cuddle me forever", content: "🫶 Cuddle me forever", kind: "message" },
] as const;
export type AffectionId = typeof AFFECTIONS[number]["id"];

/** Affections offered on the first surface — everything else lives behind "more". */
export const QUICK_AFFECTIONS: AffectionId[] = ["kiss", "hug", "miss", "muah", "ask_kiss", "rose", "moon", "ily"];

/** Short lines used by "miss you" spam bursts. Random but never rude. */
export const MISS_LINES = [
  "🤍 I miss you",
  "🤍 are you thinking about me",
  "🤍 come back",
  "🤍 I keep checking my phone",
  "🤍 I miss your voice",
  "🤍 thinking about you again",
  "🤍 where are youuu",
  "🤍 my heart is doing the thing",
  "🤍 one more minute of you, please",
  "🤍 you're my favourite notification",
  "🤍 I miss your laugh",
  "🤍 replaying our chats",
] as const;

export function affectionFor(message: Pick<Message, "kind" | "content" | "media_url">) {
  if (message.media_url) return undefined;
  if (message.kind === "miss") return AFFECTIONS.find(item => item.id === "miss" && item.kind === message.kind);
  return AFFECTIONS.find(item => item.kind === message.kind && item.content === message.content);
}
