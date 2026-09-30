import type { Message } from "./types";

export const AFFECTIONS = [
  { id: "kiss", label: "Kiss", glyph: "💋", caption: "A kiss for you", content: "💋 A kiss for you", kind: "message" },
  { id: "hug", label: "Hug", glyph: "🫂", caption: "A hug for you", content: "🫂 A hug for you", kind: "message" },
  { id: "love", label: "Love", glyph: "💗", caption: "All my love", content: "💗 All my love", kind: "message" },
  { id: "miss", label: "I miss you", glyph: "🤍", caption: "I miss you", content: "🤍 I miss you", kind: "miss" },
] as const;
export type AffectionId = typeof AFFECTIONS[number]["id"];

export function affectionFor(message: Pick<Message, "kind" | "content" | "media_url">) {
  if (message.media_url) return undefined;
  if (message.kind === "miss") return AFFECTIONS[3];
  return AFFECTIONS.find(item => item.kind === message.kind && item.content === message.content);
}
