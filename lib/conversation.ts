import { db } from "./supabase";
import type { Conversation, Profile } from "./types";

/** Resolve a selected chat directly instead of depending on the first inbox page. */
export async function loadConversation(id: string, userId: string): Promise<Conversation> {
  const result = await db().from("conversations").select("*").eq("id", id).single();
  if (result.error) throw result.error;
  const conversation = result.data as Conversation;
  let ids = [conversation.member_a, conversation.member_b].filter((value): value is string => !!value);
  if (conversation.kind === "group") {
    const members = await db().from("conversation_members").select("user_id").eq("conversation_id", id);
    if (members.error) throw members.error;
    ids = members.data.map(member => member.user_id as string);
  }
  const profiles = await db().from("profiles").select("id,username,display_name,avatar_url,mood").in("id", ids);
  if (profiles.error) throw profiles.error;
  const members: Profile[] = profiles.data.map(profile => ({ ...profile, is_pro: false }));
  return { ...conversation, members, partner: members.find(member => member.id !== userId) };
}
