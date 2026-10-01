import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { deleteSticker, listStickers, saveSticker, STICKER_BYTES, STICKER_LIMIT } from "../lib/stickers";
import { activate, clearUser } from "../lib/offline";
const photo = (value: string, size = 20) => new Blob([value.padEnd(size, "x")], { type: "image/webp" });

test("local stickers persist across connections, deduplicate and stay account scoped", async () => {
  const id = await saveSticker("stickers-a", photo("one"));
  assert.equal(await saveSticker("stickers-a", photo("one")), id);
  assert.equal((await listStickers("stickers-a")).length, 1);
  assert.equal(await (await listStickers("stickers-a"))[0].blob.text(), await photo("one").text());
  assert.equal((await listStickers("stickers-b")).length, 0);
  await saveSticker("stickers-b", photo("one"));
  await deleteSticker("stickers-b", id);
  assert.equal((await listStickers("stickers-a")).length, 1);
  assert.equal((await listStickers("stickers-b")).length, 1);
  await deleteSticker("stickers-a"); await deleteSticker("stickers-b");
});
test("saved stickers survive logout while private text is cleared", async () => {
  activate("stickers-logout"); await saveSticker("stickers-logout", photo("retained"));
  await clearUser("stickers-logout"); assert.equal((await listStickers("stickers-logout")).length, 1);
  await deleteSticker("stickers-logout");
});
test("sticker collection evicts the oldest at its count limit", async () => {
  const now = Date.now; Date.now = () => 1700000000000;
  try {
    const first = await saveSticker("stickers-count", photo("first"));
    for (let i = 0; i < STICKER_LIMIT; i++) await saveSticker("stickers-count", photo(String(i)));
    const rows = await listStickers("stickers-count"); assert.equal(rows.length, STICKER_LIMIT);
    assert.equal(rows.some(row => row.id === first), false);
    assert.equal(new Set(rows.map(row => row.created_at)).size, STICKER_LIMIT);
  } finally { Date.now = now; await deleteSticker("stickers-count"); }
});
test("sticker byte budget holds even when every file reaches the maximum", async () => {
  for (let i = 0; i < 40; i++) await saveSticker("stickers-bytes", photo(String(i), STICKER_BYTES));
  const rows = await listStickers("stickers-bytes");
  assert.ok(rows.reduce((sum, row) => sum + row.bytes, 0) <= 16 * 1024 * 1024);
  assert.ok(rows.length <= STICKER_LIMIT); await deleteSticker("stickers-bytes");
});
test("oversized or non-image files never enter the sticker database", async () => {
  await assert.rejects(saveSticker("invalid-sticker", photo("oversized", STICKER_BYTES + 1)));
  await assert.rejects(saveSticker("invalid-sticker", new Blob(["wrong"], { type: "text/html" })));
  await assert.rejects(saveSticker("", photo("missing-account")));
  assert.equal((await listStickers("invalid-sticker")).length, 0);
});
