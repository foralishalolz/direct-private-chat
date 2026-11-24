import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COUPLE_3D_MODES,
  WORLD,
  broadcastPayload,
  canCollect,
  clampPosition,
  eligibleHearts,
  heartLayout,
  mulberry32,
  nearestCollectible,
  nextRallyHeart,
  resultText,
  scoreLine,
  sideForUser,
  stepAvatar,
  validateBroadcast,
  type AvatarPosition,
  type Couple3DMatch,
} from "../lib/couple3d";

const uid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const round = "33333333-3333-4333-8333-333333333333";
const at = (x: number, y: number, z: number, t = 1000): AvatarPosition => ({ x, y, z, yaw: 0, t });
const match = (mode: Couple3DMatch["mode"], items = heartLayout(mode)): Couple3DMatch => ({
  conversation_id: "44444444-4444-4444-8444-444444444444",
  round_id: round,
  mode,
  items,
  score_a: 0,
  score_b: 0,
  winner: null,
  finished: false,
  started_by: uid,
  updated_at: new Date(1000).toISOString(),
});

test("three distinct couple worlds mirror the six-heart database layout", () => {
  assert.equal(COUPLE_3D_MODES.length, 3);
  assert.deepEqual(COUPLE_3D_MODES.map(mode => mode.id), ["orbit", "garden", "rally"]);
  assert.equal(new Set(COUPLE_3D_MODES.map(mode => mode.name)).size, 3);
  for (const mode of COUPLE_3D_MODES) {
    const hearts = heartLayout(mode.id);
    assert.equal(hearts.length, 6);
    assert.deepEqual(hearts.map(heart => heart.id), ["h1", "h2", "h3", "h4", "h5", "h6"]);
    assert.ok(hearts.every(heart => heart.collected_by === null && Math.abs(heart.x) <= 12 && heart.y >= 0 && heart.y <= 8 && Math.abs(heart.z) <= 12));
  }
  assert.notDeepEqual(heartLayout("orbit"), heartLayout("garden"));
  heartLayout("orbit")[0].collected_by = "a";
  assert.equal(heartLayout("orbit")[0].collected_by, null, "layout returns fresh copies");
});

test("sides follow the conversation members and positions stay inside the world", () => {
  assert.equal(sideForUser(uid, other, uid), "a");
  assert.equal(sideForUser(uid, other, other), "b");
  assert.equal(sideForUser(uid, other, "someone-else"), null);
  const clamped = clampPosition({ x: 99, y: -9, z: NaN, yaw: 20, t: 1 });
  assert.equal(clamped.x, WORLD.x);
  assert.equal(clamped.y, WORLD.minY);
  assert.equal(clamped.z, -WORLD.z);
  assert.ok(clamped.yaw <= 6.3);
});

test("movement is bounded, rotates and never produces NaN from a long frame", () => {
  const start = at(0, 1.3, 0);
  const forward = stepAvatar(start, new Set(["up"]), 5);
  assert.ok(forward.z < start.z, "yaw zero glides toward negative Z");
  assert.ok(Math.abs(forward.z - start.z) <= 5.2 * 0.05 + 1e-9);
  const turn = stepAvatar(start, new Set(["right"]), 0.05);
  assert.ok(turn.yaw > start.yaw && turn.yaw < 0.2);
  const extreme = stepAvatar(start, new Set(["up", "float"]), Number.POSITIVE_INFINITY);
  assert.ok(Object.values(extreme).every(value => Number.isFinite(value)));
  assert.ok(extreme.y <= WORLD.maxY);
});

test("rally exposes one star, garden needs both people, orbit accepts either", () => {
  const hearts = heartLayout("rally");
  assert.equal(nextRallyHeart(hearts)?.id, "h1");
  assert.deepEqual(eligibleHearts("rally", hearts).map(heart => heart.id), ["h1"]);
  hearts[0].collected_by = "b";
  assert.equal(nextRallyHeart(hearts)?.id, "h2");
  assert.equal(eligibleHearts("rally", hearts).length, 1);
  assert.equal(eligibleHearts("orbit", hearts).length, 5);

  const garden = heartLayout("garden");
  const mine = at(garden[0].x, garden[0].y, garden[0].z);
  assert.equal(nearestCollectible("garden", garden, mine, null, 1000), null, "partner is required");
  assert.equal(nearestCollectible("garden", garden, mine, at(50, 1, 50), 1000), null, "partner must be nearby");
  assert.equal(nearestCollectible("garden", garden, mine, at(garden[0].x, garden[0].y, garden[0].z, 900), 1000)?.id, "h1");
  assert.equal(nearestCollectible("garden", garden, mine, at(garden[0].x, garden[0].y, garden[0].z, 1), WORLD.peerStaleMs + 2000), null, "stale presence is ignored");
  assert.equal(canCollect("orbit", heartLayout("orbit"), "h1", at(-7, 2, -5), null, 1000), true);
});

test("Realtime payloads are small, scoped to a round and reject malformed input", () => {
  const mine = at(1.23456, 2, -3.45678);
  const move = broadcastPayload("move", uid, round, mine);
  assert.equal(move.x, 1.235);
  assert.equal(move.z, -3.457);
  assert.ok(JSON.stringify(move).length < 512);
  assert.equal(validateBroadcast(move, round)?.type, "move");
  assert.equal(validateBroadcast({ ...move, roundId: "another-round" }, round), null);
  assert.equal(validateBroadcast({ ...move, userId: "not-a-uuid" }, round), null);
  assert.equal(validateBroadcast({ ...move, type: "teleport" }, round), null);
  assert.equal(validateBroadcast({ ...move, t: Date.now() - 60000 }, round), null);
  assert.equal(validateBroadcast({ ...move, payload: "x".repeat(600) }, round), null);
  const collect = broadcastPayload("collect", uid, round, undefined, "h3");
  assert.deepEqual(validateBroadcast(collect, round), { ...collect, t: collect.t });
  const wild = validateBroadcast({ ...move, x: 999, y: -99, z: 999, yaw: 99 }, round);
  assert.equal(wild?.x, WORLD.x);
  assert.equal(wild?.y, WORLD.minY);
  assert.equal(wild?.z, WORLD.z);
  assert.equal(wild?.yaw, 6.3);
});

test("results stay honest about shared wins, ties and a real winner", () => {
  const orbit = match("orbit");
  assert.equal(resultText({ ...orbit, finished: true, winner: uid, score_a: 4, score_b: 2 }, uid, "Alex"), "✨ You won this round!");
  assert.equal(resultText({ ...orbit, finished: true, winner: other, score_a: 2, score_b: 4 }, uid, "Alex"), "✨ Alex won this round!");
  assert.equal(resultText({ ...orbit, finished: true, score_a: 3, score_b: 3 }, uid, "Alex"), "🤍 A tie. One more round?");
  assert.equal(resultText({ ...match("garden"), finished: true, score_a: 3, score_b: 3 }, uid, "Alex"), "🌷 Every flower bloomed together. No winner, just us.");
  assert.match(scoreLine({ ...orbit, score_a: 2, score_b: 1 }, "a", "Alex"), /You 2 · Alex 1/);
  assert.match(scoreLine({ ...match("garden"), score_a: 2, score_b: 1 }, "a", "Alex"), /3\/6 blooms together/);
  const random = mulberry32(42), second = mulberry32(42);
  assert.equal(random(), second());
  assert.ok(random() >= 0 && random() < 1);
});

test("the additive SQL keeps direct-only scoring, RLS and bounded Realtime writes", () => {
  const migration = readFileSync("supabase/migrations/20261124130000_couple_3d_arcade.sql", "utf8");
  const rules = readFileSync("supabase/migrations/20261124130100_couple_3d_rules.sql", "utf8");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  for (const clause of ["create table if not exists public.couple_3d_match", "enable row level security", "grant select on public.couple_3d_match to authenticated", "grant execute on function public.start_couple_3d", "kind='direct'", "jsonb_typeof(payload)='object'", "octet_length(payload::text)<=512", "payload->>'userId'=auth.uid()::text", "bitchat_couple3d_read", "bitchat_couple3d_write", "'arcade3d'"]) {
    assert.ok(migration.includes(clause), clause);
  }
  assert.match(rules, /Follow the constellation/);
  assert.match(rules, /new_a>=4 or new_b>=4/);
  assert.match(rules, /r\.mode='garden' then null/);
  assert.match(schema, /constraint live_arcade_mode_check check\(mode in \('four','garden','race','grid'\)\)/);
  assert.match(schema, /p_mode not in \('four','garden','race','grid'\)/);
  assert.match(schema, /kind in \('makeout','game','draw','wyr','kiss','pet','arcade','listen','arcade3d'\)/);
});

test("the app exposes the 3D sheet without external game scripts", () => {
  const activities = readFileSync("components/Activities.tsx", "utf8");
  const ping = readFileSync("hooks/useActivityPing.tsx", "utf8");
  const room = readFileSync("components/ChatRoom.tsx", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");
  assert.match(activities, /"arcade3d"/);
  assert.match(activities, /3D together/);
  assert.match(activities, /Couple3DArcade/);
  assert.match(ping, /arcade3d/);
  assert.match(room, /kind === "arcade3d" \? "arcade3d"/);
  const config = JSON.parse(vercel) as { headers: { headers: { key: string; value: string }[] }[] };
  const csp = config.headers.flatMap(group => group.headers).find(header => header.key === "Content-Security-Policy")?.value ?? "";
  const scriptDirective = csp.split(";").map(part => part.trim()).find(part => part.startsWith("script-src"));
  assert.equal(scriptDirective, "script-src 'self' 'unsafe-inline'");
});
