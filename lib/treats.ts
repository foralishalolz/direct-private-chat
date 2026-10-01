export const TREAT_QUESTION = "🍓 Pick our treat";
export const TREATS = [
  { id: "cookie", glyph: "🍪", label: "Cookie", option: "🍪 Cookie" },
  { id: "icecream", glyph: "🍦", label: "Ice cream", option: "🍦 Ice cream" },
  { id: "strawberry", glyph: "🍓", label: "Strawberries", option: "🍓 Strawberries" },
  { id: "pancakes", glyph: "🥞", label: "Pancakes", option: "🥞 Pancakes" },
] as const;
type Collection = { version: 1; rounds: string[]; treats: string[] };
const key = (userId: string, conversationId: string) => "bitchat-treats-v1:" + userId + ":" + conversationId;
export function treatCollection(userId: string, conversationId: string): Collection {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId, conversationId)) ?? "null");
    if (value?.version === 1 && Array.isArray(value.rounds) && Array.isArray(value.treats)) return {
      version: 1, rounds: value.rounds.filter((id: unknown) => typeof id === "string" && id.length <= 40).slice(-32),
      treats: TREATS.filter(treat => value.treats.includes(treat.id)).map(treat => treat.id),
    };
  } catch {}
  return { version: 1, rounds: [], treats: [] };
}
/** Device-local decorative stamps. These grant no privileges or shared statistics. */
export function collectTreat(userId: string, conversationId: string, roundId: string, choice: number) {
  const collection = treatCollection(userId, conversationId), treat = TREATS[choice];
  if (!treat || collection.rounds.includes(roundId)) return collection;
  const next: Collection = { version: 1, rounds: [...collection.rounds, roundId].slice(-32), treats: [...new Set([...collection.treats, treat.id])] };
  try { localStorage.setItem(key(userId, conversationId), JSON.stringify(next)); } catch {}
  return next;
}
