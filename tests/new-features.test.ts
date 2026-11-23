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
