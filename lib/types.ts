export type Profile = { id: string; username: string; display_name: string; avatar_url: string | null; mood: string | null; is_pro: boolean };
export type Conversation = { id: string; kind: "direct" | "group"; title: string; member_a: string | null; member_b: string | null; created_at: string; last_activity: string; read_a: string | null; read_b: string | null; couple_a: boolean; couple_b: boolean; partner?: Profile; members?: Profile[]; preview?: string; unread?: boolean; read_at?: string | null };
export type Message = { id: string; conversation_id: string; user_id: string; content: string; media_url: string | null; media_kind: "image" | "audio" | "video" | null; kind: "message" | "instant" | "sticker" | "miss"; instant_viewed: boolean; reply_to?: string | null; created_at: string; status?: "queued" | "failed" };
export type Reaction = { message_id: string; user_id: string; emoji: string };
export type Journal = { id: string; body: string; mood: string | null; created_at: string };
export type Capsule = { id: string; conversation_id: string; user_id: string; unlock_at: string; created_at: string };
export type Game = { id: string; game_type: "question" | "either" | "tic_tac_toe"; question: string; option_a: string | null; option_b: string | null; created_by: string; next_player: string | null; board: string; winner: string | null; ended_at: string | null; created_at: string };
export type Poll = { id: string; conversation_id: string; question: string; options: string[]; created_at: string; closes_at: string };
export const MOODS = ["🥰","😊","🥺","😴","😔","😤","🤍","🫶"];
export const REACTIONS = ["❤️","😂","🥺","🔥","😘","🫶"];
export const label = (p?: Partial<Profile>) => p?.display_name || p?.username || "";
export const title = (c: Conversation) => c.kind === "group" ? c.title : label(c.partner);
export const subtitle = (c: Conversation) => c.kind === "group" ? String(c.members?.length ?? 0) + " members" : "@" + (c.partner?.username ?? "");
export const time = (s: string) => new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const day = (s: string) => new Date(s).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
export function merge(rows: Message[], incoming: Message[]) {
  const map = new Map(rows.map(m => [m.id,m]));
  for (const row of incoming) map.set(row.id,row);
  return [...map.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export function usernameEmail(value: string) {
  const name = value.trim().toLowerCase().replace(/^@/,"");
  if (!/^[a-z0-9_]{3,24}$/.test(name)) throw new Error("Use 3–24 letters, numbers or underscores.");
  return name + "@chat.local";
}
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : "Please try again.";
  if (/Invalid login credentials/i.test(text)) return "Username or password is incorrect.";
  if (/Email not confirmed/i.test(text)) return "This account needs activation.";
  if (/abort|timeout/i.test(text)) return "Connection timed out. Try again.";
  if (/row-level|permission denied/i.test(text)) return "This action is unavailable.";
  if (/fetch|network/i.test(text)) return "Connection lost. Try again.";
  return text.slice(0,180);
}
