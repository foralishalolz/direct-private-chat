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

test("duplicate call offers are coalesced and answered idempotently", async () => {
  const { CallLink } = await import("../lib/rtc");
  const oldPC=globalThis.RTCPeerConnection,oldStream=globalThis.MediaStream;
  let offers=0,answers=0;
  class FakeStream { getTracks(){return [];} addTrack(){} }
  class FakePeer {
    localDescription: RTCSessionDescription|null=null;
    remoteDescription: RTCSessionDescription|null=null;
    currentLocalDescription: RTCSessionDescription|null=null;
    signalingState="stable";
    async createOffer(){offers++;await new Promise(resolve=>setTimeout(resolve,5));return {type:"offer",sdp:"offer-sdp"};}
    async createAnswer(){answers++;await new Promise(resolve=>setTimeout(resolve,5));return {type:"answer",sdp:"answer-sdp"};}
    async setLocalDescription(d: RTCSessionDescription){this.localDescription=d;this.currentLocalDescription=d;}
    async setRemoteDescription(d: RTCSessionDescription){this.remoteDescription=d;}
    async addIceCandidate(){} close(){} getSenders(){return [];}
  }
  Object.assign(globalThis,{RTCPeerConnection:FakePeer,MediaStream:FakeStream});
  try {
    const link=new CallLink({onSignal:()=>{},onState:()=>{},onRemote:()=>{}},"me");
    const [o1,o2]=await Promise.all([link.offer(),link.offer()]);
    assert.equal(o1.sdp,"offer-sdp");assert.equal(o2.sdp,"offer-sdp");assert.equal(offers,1);
    await link.offer();assert.equal(offers,1);
    const [a1,a2]=await Promise.all([link.answer({type:"offer",sdp:"remote-sdp"}),link.answer({type:"offer",sdp:"remote-sdp"})]);
    assert.equal(a1.sdp,"answer-sdp");assert.equal(a2.sdp,"answer-sdp");assert.equal(answers,1);
    await link.answer({type:"offer",sdp:"remote-sdp"});assert.equal(answers,1);link.close();
  } finally { Object.assign(globalThis,{RTCPeerConnection:oldPC,MediaStream:oldStream}); }
});

test("call signaling sends SDP answers and retries the ready handshake", () => {
  const hook=readFileSync("hooks/useCall.ts","utf8");
  assert.match(hook,/signal\(\{ type: "answer", sdp: response\.sdp \}\)/);
  assert.match(hook,/setInterval\(\(\) => \{ if \(phaseRef\.current === "connecting"\) void signal\(\{ type: "ready" \}\); \}, 3000\)/);
});

test("calls replay early candidates and bound failed connections", () => {
  const hook=readFileSync("hooks/useCall.ts","utf8");
  assert.match(hook,/sentCandidates\.current\.push\(frame\)/);
  assert.match(hook,/for \(const candidate of sentCandidates\.current\)/);
  assert.match(hook,/Couldn’t connect\. Check your network or call relay/);
  const thread=readFileSync("components/ChatThread.tsx","utf8");
  assert.match(thread,/call\.call\?\.id!==callIntent\.callId/);
});
