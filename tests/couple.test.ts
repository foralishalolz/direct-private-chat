import assert from "node:assert/strict";
import test from "node:test";
import { kissLevel, streakWord, heartBurst } from "../lib/kiss";
import { readUsername } from "../lib/deeplink";
import { AFFECTIONS, affectionFor, MISS_LINES, QUICK_AFFECTIONS } from "../lib/affection";
import { myPet, theirPet, title, type Conversation, type Profile } from "../lib/types";

const person = (id: string, username: string): Profile => ({ id, username, display_name: "", avatar_url: null, mood: null, is_pro: false });
const a = person("00000000-0000-0000-0000-00000000000a", "alice");
const b = person("00000000-0000-0000-0000-00000000000b", "bob");
const chat = (patch: Partial<Conversation> = {}): Conversation => ({
  id: "c", kind: "direct", title: "", member_a: a.id, member_b: b.id, created_at: "", last_activity: "",
  read_a: null, read_b: null, couple_a: true, couple_b: true, partner: b, members: [a, b], ...patch,
});

test("kiss levels climb and cap at the last step", () => {
  assert.equal(kissLevel(0).label, "Shy");
  assert.equal(kissLevel(6).label, "Warming up");
  assert.equal(kissLevel(49).label, "Butterflies");
  assert.equal(kissLevel(5000).label, "Legendary");
  assert.equal(kissLevel(5000).next, undefined);
  assert.equal(Math.round(kissLevel(13).progress * 100), 50);
});

test("kiss helpers never produce NaN or off-screen damage", () => {
  for (let i = 0; i < 60; i++) {
    const burst = heartBurst(i);
    assert.ok(burst.left >= 0 && burst.left <= 100);
    assert.ok(Number.isFinite(burst.drift) && Number.isFinite(burst.rise));
  }
  assert.equal(typeof streakWord(0), "string");
  assert.equal(streakWord(999), streakWord(999));
});

test("deep links accept handles and reject anything else", () => {
  assert.equal(readUsername("/u/alice"), "");
  assert.equal(readUsername("@Alice"), "alice");
  assert.equal(readUsername("bo_b"), "bo_b");
  assert.equal(readUsername("alice bob"), "");
  assert.equal(readUsername("<script>"), "");
  assert.equal(readUsername(""), "");
});

test("every affection keeps readable content and a unique id", () => {
  const ids = new Set();
  for (const item of AFFECTIONS) {
    assert.ok(item.content.trim().length > 0);
    assert.ok(!ids.has(item.id), "duplicate id " + item.id);
    ids.add(item.id);
    assert.equal(affectionFor({ content: item.content, kind: item.kind, media_url: null })?.id, item.id);
  }
  for (const id of QUICK_AFFECTIONS) assert.ok(AFFECTIONS.some(item => item.id === id), "quick affection missing " + id);
  assert.equal(new Set(MISS_LINES).size, MISS_LINES.length);
});

test("nicknames follow the side that wrote them", () => {
  // pet_a is what member_a (alice) calls member_b (bob).
  const c = chat({ pet_a: "kitten", pet_b: "dada" });
  assert.equal(theirPet(c), "kitten");
  assert.equal(myPet(c), "dada");
  assert.equal(title(c), "kitten");
  // Flip the sides: now member_a is bob, and pet_a names alice (the partner).
  const flipped = chat({ pet_a: "kitten", pet_b: "dada", member_a: b.id, member_b: a.id, partner: a });
  assert.equal(theirPet(flipped), "kitten");
  assert.equal(myPet(flipped), "dada");
  assert.equal(title(chat()), "bob");
  assert.equal(title(chat({ kind: "group", title: "Crew", partner: undefined })), "Crew");
});
