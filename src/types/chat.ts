export type UserRole = "admin" | "user";

export type CoupleRole = "kitten" | "dada";

export type MessageKind = "text" | "image" | "video" | "audio" | "sticker";

export type PlanCategory =
  | "date"
  | "trip"
  | "call"
  | "movie"
  | "game"
  | "other";

export interface Profile {
  id: string;
  username: string;
  role: UserRole;
  display_name?: string | null;
  avatar_url?: string | null;
  accent?: string | null;
  bio?: string | null;
  couple_role?: CoupleRole | null;
  last_seen_at?: string | null;
  created_at?: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by?: string | null;
  is_direct: boolean;
  created_at: string;
  /** Local-only enrichment */
  last_message_at?: string | null;
  last_message_preview?: string | null;
  last_message_kind?: MessageKind | null;
  last_message_user?: string | null;
  unread_count?: number;
  /** For 1:1 chats: the other person, resolved client-side. */
  partner?: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
    accent: string | null;
    last_seen_at: string | null;
    couple_role: CoupleRole | null;
  } | null;
  member_count?: number;
  muted?: boolean;
}

export interface ChatMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  kind: MessageKind;
  media_url: string | null;
  media_type: string | null;
  duration_seconds: number | null;
  reply_to_id: string | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  // client-only
  status?: "sending" | "sent" | "failed";
  readBy?: string[];
}

export interface MessageCursor {
  id: string;
  created_at: string;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface Plan {
  id: string;
  group_id: string;
  title: string;
  notes: string | null;
  category: PlanCategory;
  starts_at: string;
  duration_minutes: number | null;
  location: string | null;
  created_by: string;
  completed: boolean;
  created_at: string;
}

export interface LoveNote {
  id: string;
  group_id: string;
  user_id: string;
  prompt: string | null;
  body: string;
  created_at: string;
}

export interface TypingState {
  user_id: string;
  display_name: string;
  last_seen_at: string;
}

export interface PresenceState {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  online_at: string;
}

export type GameKind =
  | "would_you_rather"
  | "this_or_that"
  | "truth_or_dare"
  | "two_truths"
  | "tictactoe"
  | "connect4";

export interface GameSession {
  id: string;
  group_id: string;
  kind: GameKind;
  state: Record<string, unknown>;
  turn_user_id: string | null;
  status: "active" | "finished";
  created_by: string;
  created_at: string;
  updated_at: string;
  title?: string | null;
}
