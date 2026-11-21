export type UserRole = "admin" | "user";

export type MediaType = "image" | "video";

export interface ChatMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
  media_url?: string | null;
  media_type?: MediaType | null;
  media_name?: string | null;
  media_size?: number | null;
  client_pending?: boolean;
  client_failed?: boolean;
}

export interface Profile {
  id: string;
  username: string;
  role: UserRole;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface MessageCursor {
  id: string;
  created_at: string;
}

/* ── Couples ─────────────────────────────────────────────────────── */

export type CoupleCuteRole = "kitten" | "daddy";

export interface Couple {
  id: string;
  name: string | null;
  created_by: string;
  created_at: string;
}

export interface CoupleMember {
  couple_id: string;
  user_id: string;
  cute_role: CoupleCuteRole;
  since: string;
}

export interface Plan {
  id: string;
  couple_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  created_by: string;
  done: boolean;
  created_at: string;
}

/* ── Games ───────────────────────────────────────────────────────── */

export type GameKind = "tictactoe";

export type GameStatus = "playing" | "won" | "draw";

export interface Game {
  id: string;
  couple_id: string;
  kind: GameKind;
  board: ("x" | "o" | null)[];
  current_turn: "x" | "o";
  status: GameStatus;
  winner_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}
