import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callLabel, formatDuration, iceServers, mediaSupported } from "../lib/rtc";
import { isCallJob } from "../supabase/functions/_shared/push";

const base = { started_at: new Date(Date.now() - 120000).toISOString(), answered_at: null, ended_at: null };

test("call durations format like a phone app and never go negative", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(9), "0:09");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3671), "1:01:11");
  assert.equal(formatDuration(-40), "0:00");
  assert.equal(formatDuration(Number.NaN), "0:00");
});

test("call labels separate missed, declined, failed and answered calls", () => {
  assert.equal(callLabel({ ...base, status: "missed" }), "Missed");
  assert.equal(callLabel({ ...base, status: "declined" }), "Declined");
  assert.equal(callLabel({ ...base, status: "failed" }), "Couldn’t connect");
  assert.equal(callLabel({ ...base, status: "ringing" }), "Ringing…");
  // Answered two minutes ago and never ended: duration, not "Ringing".
  const answered = callLabel({ ...base, status: "active", answered_at: new Date(Date.now() - 120000).toISOString() });
  assert.match(answered, /^2:0\d$/);
  // Answered but hung up 30s later: the answer time is what counts.
  const ended = callLabel({
    started_at: new Date(Date.now() - 600000).toISOString(),
    answered_at: new Date(Date.now() - 120000).toISOString(),
    ended_at: new Date(Date.now() - 90000).toISOString(),
    status: "ended",
  });
  assert.equal(ended, "0:30");
});

test("ICE always offers STUN and only adds TURN when configured", () => {
  const servers = iceServers();
  assert.ok(servers.length >= 1);
  assert.ok(servers.every(server => Array.isArray(server.urls) || typeof server.urls === "string"));
  const flat = servers.flatMap(server => (Array.isArray(server.urls) ? server.urls : [server.urls]));
  assert.ok(flat.some(url => url.startsWith("stun:")));
  assert.ok(flat.every(url => /^(stun|turn|turns):/.test(url)), "no plain-text or http peers");
});

test("media support is a boolean in a headless environment", () => {
  assert.equal(typeof mediaSupported(), "boolean");
  assert.equal(mediaSupported(), false);
});

test("push jobs distinguish a ringing call from a message", () => {
  assert.equal(isCallJob({ kind: "call" }), true);
  assert.equal(isCallJob({ kind: "message" }), false);
  assert.equal(isCallJob({}), false);
  assert.equal(isCallJob({ kind: null }), false);
});

test("the service worker answers calls without ever opening a chat URL for them", () => {
  const source = readFileSync("public/sw-template.js", "utf8");
  assert.match(source, /bitchat-open-call/);
  assert.match(source, /call:"\+data\.userId/);
  assert.match(source, /actions:\[\{action:"accept"/);
  // Calls must expire quickly so a stale ring is never shown hours later.
  assert.match(source, /Date\.now\(\)-data\.timestamp>60000/);
  // The call payload carries ids only — no names, message text or media.
  assert.doesNotMatch(source, /display_name|avatar_url/);
});
