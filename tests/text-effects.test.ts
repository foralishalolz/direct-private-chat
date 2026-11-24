import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEXT_EFFECTS, normalizeTextEffect, textEffectLabel } from "../lib/textEffects";

test("text effects are a strict, unique presentation enum", () => {
  const ids = TEXT_EFFECTS.map(effect => effect.id);
  assert.equal(ids[0], "normal");
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("big") && ids.includes("small") && ids.includes("shake"));
  assert.ok(ids.includes("ripple") && ids.includes("bloom") && ids.includes("explode"));
});

test("unknown effects cannot become CSS classes", () => {
  assert.equal(normalizeTextEffect(null), null);
  assert.equal(normalizeTextEffect("normal"), null);
  assert.equal(normalizeTextEffect("drop-shadow(0 0 0 red)"), null);
  assert.equal(normalizeTextEffect({ id: "big" }), null);
  assert.equal(normalizeTextEffect("BIG"), null);
  assert.equal(normalizeTextEffect("big"), "big");
  assert.equal(normalizeTextEffect("explode"), "explode");
  assert.equal(textEffectLabel("ripple"), "Ripple");
  assert.equal(textEffectLabel("invalid"), "Normal");
});

test("effects persist through the optimistic queue and direct sends", () => {
  const messages = readFileSync("hooks/useMessages.ts", "utf8");
  const outbox = readFileSync("hooks/useOutbox.ts", "utf8");
  const composer = readFileSync("components/Composer.tsx", "utf8");
  const bubble = readFileSync("components/MessageBubble.tsx", "utf8");
  assert.match(messages, /text_effect:effect/);
  assert.match(outbox, /text_effect: text_effect \?\? null/);
  assert.match(composer, /onSend\(draft, replyId, chosen\)/);
  assert.match(composer, /TEXT_EFFECTS\.map/);
  assert.match(bubble, /effect\?" effect-"\+effect/);
});

test("the database accepts only known effects and reloads the API schema", () => {
  const migration = readFileSync("supabase/migrations/20261124120000_ios_text_effects.sql", "utf8");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  for (const sql of [migration, schema]) {
    assert.match(sql, /add column if not exists text_effect text/);
    assert.match(sql, /'big','small','shake','ripple','bloom','explode'/);
    assert.match(sql, /notify pgrst, 'reload schema'/);
  }
});

test("native polish fixes the keyboard/lower-chat scroll geometry", () => {
  const css = readFileSync("app/native-polish.css", "utf8");
  const tabs = readFileSync("hooks/useTabBar.ts", "utf8");
  const room = readFileSync("components/ChatRoom.tsx", "utf8");
  assert.match(css, /height: var\(--app-height, 100dvh\)/);
  assert.match(css, /html\[data-keyboard-open="true"\] \.app-shell/);
  assert.match(css, /\.conversation-list, \.thread-scroll \{ flex: 1 1 auto; overflow-y: auto/);
  assert.match(css, /\.bubble\.effect-big \.message-text/);
  assert.match(tabs, /const reset = useCallback/);
  assert.match(room, /tabs\.reset\(\)/);
});
