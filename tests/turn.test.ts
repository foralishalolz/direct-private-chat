import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTurn } from "../lib/turn";

test("relay addresses are validated before they can break calling", () => {
  assert.deepEqual(normalizeTurn({ url: "turn:relay.example.com:3478", username: " u ", credential: " p " }), {
    url: "turn:relay.example.com:3478", username: "u", credential: "p",
  });
  assert.equal(normalizeTurn({ url: " turns:relay.example.com:5349?transport=tcp ", username: "", credential: "" }).url, "turns:relay.example.com:5349?transport=tcp");
  assert.equal(normalizeTurn({ url: "turn:10.0.0.1:3478?transport=udp", username: "", credential: "" }).url, "turn:10.0.0.1:3478?transport=udp");
});

test("relay addresses that are not relays are rejected", () => {
  for (const url of ["", "stun:stun.example.com", "https://relay.example.com", "turn:", "turn:bad host:3478", "turn:host:99999", "turn:host?transport=sctp"]) {
    assert.throws(() => normalizeTurn({ url, username: "", credential: "" }), /relay/i, url);
  }
});

test("relay credentials cannot be used to smuggle long payloads into storage", () => {
  const result = normalizeTurn({ url: "turn:r.example.com:3478", username: "u".repeat(500), credential: "c".repeat(500) });
  assert.equal(result.username.length, 200);
  assert.equal(result.credential.length, 200);
});
