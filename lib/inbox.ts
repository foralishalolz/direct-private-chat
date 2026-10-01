import type { Conversation, Message } from "./types";

export function messagePreview(message: Pick<Message, "kind" | "content" | "media_kind">) {
  if (message.kind === "instant") return "Photo";
  if (message.kind === "sticker") return "Sticker";
  if (message.kind === "miss") return "🤍";
  if (message.content) return message.content.slice(0, 120);
  return message.media_kind === "image" ? "Photo" : message.media_kind === "video" ? "Video" : message.media_kind === "audio" ? "Voice note" : "";
}
/** Realtime previews are immediate; the bounded HTTP refresh remains authoritative. */
export function applyInboxMessage(items: Conversation[], message: Message, userId: string) {
  return items.map(item => {
    if (item.id !== message.conversation_id || message.created_at < item.last_activity) return item;
    return { ...item, preview: messagePreview(message), last_activity: message.created_at, unread: message.user_id === userId ? item.unread : !item.read_at || item.read_at < message.created_at };
  }).sort((a, b) => b.last_activity.localeCompare(a.last_activity) || b.id.localeCompare(a.id));
}
export function applyInboxRead(items: Conversation[], conversationId: string, stamp: string) {
  return items.map(item => item.id === conversationId ? { ...item, read_at: !item.read_at || stamp > item.read_at ? stamp : item.read_at, unread: stamp >= item.last_activity ? false : item.unread } : item);
}
export function announceRead(userId: string, conversationId: string, stamp: string) {
  window.dispatchEvent(new CustomEvent("bitchat-inbox-read", { detail: { userId, conversationId, stamp } }));
}
