import { test } from "node:test";
import assert from "node:assert/strict";
import { EMOJI_ROWS, EMOJI_GROUPS } from "../lib/emoji-data";
import { findStroke, type Stroke } from "../components/DrawBoard";

test("emoji catalogue includes all categories, skin tones and unique glyphs", () => {
  const glyphs = EMOJI_ROWS.map(row => row[0]);
  assert.ok(glyphs.length > 3000);
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.ok(glyphs.includes("👋🏽"));
  assert.ok(glyphs.includes("🏳️‍🌈"));
  for (const group of EMOJI_GROUPS) assert.ok(EMOJI_ROWS.some(row => row[1] === group));
});
test("eraser finds strokes between recorded points", () => {
  const strokes: Stroke[] = [{ id: "line", by: "a", color: "#fff", width: 3, points: [[0, 0], [1, 1]] }];
  assert.equal(findStroke(strokes, [0.5, 0.5], 0.04), "line");
  assert.equal(findStroke(strokes, [0.1, 0.9], 0.04), null);
});

test("pending board edits merge with unrelated server strokes", async () => {
  const { mergeBoard } = await import("../lib/board");
  const a: Stroke = { id: "a", by: "1", color: "#ffffff", width: 3, points: [[0, 0]] };
  const b: Stroke = { ...a, id: "b", by: "2" };
  const pending = new Map([["a", { stroke: { ...a, points: [[0.5, 0.5]] as [number, number][] }, version: 1 }]]);
  const merged = mergeBoard([a, b], pending);
  assert.deepEqual(merged.map(s => s.id).sort(), ["a", "b"]);
  assert.deepEqual(merged.find(s => s.id === "a")?.points, [[0.5, 0.5]]);
  assert.deepEqual(mergeBoard([a, b], new Map([["a", { stroke: null, version: 2 }]])).map(s => s.id), ["b"]);
});


test("kiss bursts are split into batches without dropping taps", async () => {
  const { kissBatch } = await import("../lib/kiss");
  let remaining = 37, sent = 0;
  while (remaining) { const batch = kissBatch(remaining); assert.ok(batch > 0 && batch <= 12); remaining -= batch; sent += batch; }
  assert.equal(sent, 37);
  assert.equal(kissBatch(NaN), 0);
});

test("feels and spicy decks contain editable, distinct prompts", async () => {
  const { FEELINGS, COMFORTS, KISSES, SPICY_QUESTIONS } = await import("../lib/couple");
  for (const deck of [FEELINGS, COMFORTS, KISSES]) {
    assert.equal(new Set(deck.map(item => item.id)).size, deck.length);
    assert.ok(deck.every(item => item.line.length > 0));
  }
  assert.ok(SPICY_QUESTIONS.length >= 10);
  assert.equal(new Set(SPICY_QUESTIONS).size, SPICY_QUESTIONS.length);
});
