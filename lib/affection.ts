import type { Message } from "./types";

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
] as const;
export type AffectionId = typeof AFFECTIONS[number]["id"];

export function affectionFor(message: Pick<Message, "kind" | "content" | "media_url">) {
  if (message.media_url) return undefined;
  if (message.kind === "miss") return AFFECTIONS[3];
  return AFFECTIONS.find(item => item.kind === message.kind && item.content === message.content);
}
