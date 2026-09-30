import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import webpush from "web-push";
import "fake-indexeddb/auto";
import { writePushState, readPushState } from "../lib/pushState";
import { AFFECTIONS, affectionFor } from "../lib/affection";
import { endpointAllowed, pushPayload } from "../supabase/functions/_shared/push";

const userId = "11111111-1111-4111-8111-111111111111", conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
test("affection messages retain readable content and legacy miss messages", () => {
  for (const item of AFFECTIONS) assert.equal(affectionFor({ content: item.content, kind: item.kind, media_url: null })?.id, item.id);
  assert.equal(affectionFor({ content: "", kind: "miss", media_url: null })?.id, "miss");
  assert.equal(affectionFor({ content: "Love some coffee?", kind: "message", media_url: null }), undefined);
  assert.equal(affectionFor({ content: AFFECTIONS[0].content, kind: "message", media_url: "photo.webp" }), undefined);
});
test("push endpoints reject local hosts, credentials, redirects to arbitrary hosts and unsafe ports", () => {
  for (const value of ["https://fcm.googleapis.com/fcm/send/token", "https://updates.push.services.mozilla.com/wpush/v2/token", "https://web.push.apple.com/Qtoken", "https://wns2.notify.windows.com/w/?token=abc"]) assert.ok(endpointAllowed(value));
  for (const value of ["https://localhost/path", "http://fcm.googleapis.com/path", "https://fcm.googleapis.com.evil.test/path", "https://evilpush.services.mozilla.com/path", "https://user@fcm.googleapis.com/path", "https://fcm.googleapis.com:8443/path", "https://fcm.googleapis.com/path#secret", "file:///etc/passwd", "https://127.0.0.1/path", "https://fcm.googleapis.com/"]) assert.ok(!endpointAllowed(value), value);
});
test("VAPID is correctly signed and the recipient can decrypt the actual Web Push request", () => {
  const receiver = createECDH("prime256v1"); receiver.generateKeys();
  const receiverKey = receiver.getPublicKey(), auth = randomBytes(16), vapid = webpush.generateVAPIDKeys();
  const payload = pushPayload({ user_id: userId, conversation_id: conversationId, message_id: messageId });
  const request = webpush.generateRequestDetails({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: receiverKey.toString("base64url"), auth: auth.toString("base64url") } }, payload,
    { vapidDetails: { ...vapid, subject: "https://bitchwyat.vercel.app" }, TTL: 3600, contentEncoding: "aes128gcm", urgency: "normal", topic: conversationId.replaceAll("-", "") });
  assert.equal(request.headers["Content-Encoding"], "aes128gcm");
  assert.equal(request.headers.TTL, 3600);
  const header = String(request.headers.Authorization), jwt = header.match(/t=([^,]+)/)![1], parts = jwt.split(".");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.sub, "https://bitchwyat.vercel.app");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86401);
  const publicVapid = Buffer.from(vapid.publicKey, "base64url");
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: publicVapid.subarray(1, 33).toString("base64url"), y: publicVapid.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(parts[0] + "." + parts[1]), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url")));
  const body = request.body!, salt = body.subarray(0, 16), senderKey = body.subarray(21, 21 + body[20]);
  const shared = receiver.computeSecret(senderKey), info = Buffer.concat([Buffer.from("WebPush: info\0"), receiverKey, senderKey]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const encrypted = body.subarray(21 + body[20]), decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2); assert.equal(plain.subarray(0, -1).toString(), payload);
  assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ["conversationId", "messageId", "timestamp", "userId"]);
  assert.equal(body.includes(Buffer.from(userId)), false);
});
test("service worker delivers closed-tab push once, keeps content private, and rejects another account or an expired payload", async () => {
  const handlers = new Map<string, (event: unknown) => void>(), notifications: { title: string; options: Record<string, unknown> }[] = [];
  const worker = { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler), registration: { showNotification: async (title: string, options: Record<string, unknown>) => { notifications.push({ title, options }); } }, location: { origin: "https://bitchwyat.vercel.app" } };
  vm.runInNewContext(readFileSync("public/sw-template.js", "utf8"), { self: worker, indexedDB, URL, Date, VERSION: "test", ASSETS: [] });
  const payload = { userId, conversationId, messageId, timestamp: Date.now() };
  async function deliver(value: unknown) { let pending = Promise.resolve(); handlers.get("push")!({ data: { json: () => value }, waitUntil: (work: Promise<void>) => { pending = work; } }); await pending; }
  await writePushState({ userId, enabled: true }); assert.equal((await readPushState())?.userId, userId);
  await deliver(payload); await deliver(payload); assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "BitchAt"); assert.equal(notifications[0].options.body, "New message");
  await deliver({ ...payload, userId: "22222222-2222-4222-8222-222222222222", messageId: crypto.randomUUID() });
  await deliver({ ...payload, timestamp: Date.now() - 4000000, messageId: crypto.randomUUID() });
  await deliver({ ...payload, conversationId: "https://evil.test/", messageId: crypto.randomUUID() });
  assert.equal(notifications.length, 1);
  await writePushState(null); await deliver({ ...payload, messageId: crypto.randomUUID() }); assert.equal(notifications.length, 1);
});
test("a worker update activates without reloading a draft and retains the previous immutable chunks", async () => {
  const handlers = new Map<string, (event: unknown) => void>(), removed: string[] = [];
  let activated = 0, claimed = 0;
  const caches = { open: async () => ({ addAll: async () => {} }), keys: async () => ["bitchat-shell-oldest", "unrelated", "bitchat-shell-previous", "bitchat-shell-current"], delete: async (name: string) => { removed.push(name); }, match: async () => new Response("previous chunk") };
  const self = { addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn), skipWaiting: async () => { activated++; }, clients: { claim: async () => { claimed++; } }, location: { origin: "https://bitchwyat.vercel.app" } };
  vm.runInNewContext(readFileSync("public/sw-template.js", "utf8"), { self, caches, URL, VERSION: "bitchat-shell-current", ASSETS: ["/index.html"] });
  let pending = Promise.resolve(); const event = { waitUntil: (work: Promise<void>) => { pending = work; } };
  handlers.get("install")!(event); await pending; handlers.get("activate")!(event); await pending;
  assert.equal(activated, 1); assert.equal(claimed, 1); assert.deepEqual(removed, ["bitchat-shell-oldest"]);
  let response: Promise<Response> | undefined;
  handlers.get("fetch")!({ request: { method: "GET", url: "https://bitchwyat.vercel.app/_next/static/old.js" }, respondWith: (work: Promise<Response>) => { response = work; } });
  assert.equal(await (await response!).text(), "previous chunk"); response = undefined;
  handlers.get("fetch")!({ request: { method: "GET", url: "https://llweydgvtpwgnslvgnqm.supabase.co/storage/v1/photo" }, respondWith: (work: Promise<Response>) => { response = work; } });
  assert.equal(response, undefined);
});
