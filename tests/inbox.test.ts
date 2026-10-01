import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInboxMessage, applyInboxRead, messagePreview } from "../lib/inbox";
import { collectTreat, treatCollection } from "../lib/treats";
import type { Conversation, Message } from "../lib/types";
import {requestSignal} from "../lib/request";

const conversation: Conversation = { id: "room", kind: "direct", title: "", member_a: "me", member_b: "you", created_at: "2026-09-30T10:00:00Z", last_activity: "2026-09-30T10:00:00Z", read_a: null, read_b: null, couple_a: true, couple_b: true, archived: true, read_at: "2026-09-30T09:00:00Z", unread: true };
const message: Message = { id: "message", conversation_id: "room", user_id: "you", content: "💋 Muahh!", kind: "message", media_url: null, media_kind: null, instant_viewed: false, created_at: "2026-09-30T10:01:00Z" };
test("instant inbox previews preserve archive state and reject late messages", () => {
  const next = applyInboxMessage([conversation], message, "me");
  assert.equal(next[0].preview, "💋 Muahh!"); assert.equal(next[0].unread, true); assert.equal(next[0].archived, true);
  assert.equal(applyInboxMessage(next, { ...message, content: "older", created_at: "2026-09-30T09:00:00Z" }, "me")[0], next[0]);
  assert.equal(applyInboxMessage(next, { ...message, conversation_id: "outsider" }, "me")[0], next[0]);
});
test("read markers never regress or mark a newer unseen message read", () => {
  const seen = applyInboxRead([conversation], "room", "2026-09-30T10:00:00Z"); assert.equal(seen[0].unread, false);
  const late = applyInboxRead(seen, "room", "2026-09-30T09:00:00Z"); assert.equal(late[0].read_at, seen[0].read_at);
  const newer = applyInboxMessage(seen, message, "me"); assert.equal(applyInboxRead(newer, "room", "2026-09-30T10:00:00Z")[0].unread, true);
});
test("previews retain readable affection and contain no ephemeral image URLs", () => {
  assert.equal(messagePreview(message), "💋 Muahh!");
  assert.equal(messagePreview({ ...message, kind: "instant", content: "private" }), "Photo");
  assert.equal(messagePreview({ ...message, content: "x".repeat(300) }).length, 120);
  assert.equal(messagePreview({ ...message, content: "", media_kind: "audio" }), "Voice note");
});
test("treat stamps are account-scoped, idempotent and bounded even when storage fails", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    collectTreat("me", "room", "first", 2); collectTreat("me", "room", "first", 2);
    assert.deepEqual(treatCollection("me", "room").treats, ["strawberry"]); assert.equal(treatCollection("me", "room").rounds.length, 1);
    assert.equal(treatCollection("you", "room").treats.length, 0);
    for (let i = 0; i < 80; i++) collectTreat("me", "room", "round-" + i, i % 4);
    assert.equal(treatCollection("me", "room").rounds.length, 32); assert.equal(treatCollection("me", "room").treats.length, 4);
    values.set("bitchat-treats-v1:me:room", "broken"); assert.equal(treatCollection("me", "room").treats.length, 0);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("full"); } } });
    assert.deepEqual(collectTreat("me", "room", "offline", 1).treats, ["icecream"]);
  } finally { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); }
});
test("older-browser request cancellation combines a user abort and a deadline",async()=>{
 const previous=Object.getOwnPropertyDescriptor(AbortSignal,"any");Object.defineProperty(AbortSignal,"any",{configurable:true,value:undefined});
 try {
  const controller=new AbortController(),combined=requestSignal(controller.signal,100);controller.abort(new Error("closed"));assert.equal(combined.aborted,true);assert.equal(combined.reason.message,"closed");
  const deadline=requestSignal(new AbortController().signal,5);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(deadline.aborted,true);assert.equal(deadline.reason.name,"TimeoutError");
 }finally{if(previous)Object.defineProperty(AbortSignal,"any",previous);}
});
