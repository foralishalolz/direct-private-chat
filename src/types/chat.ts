export type UserRole = "admin" | "user";

export interface ChatMessage {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
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
