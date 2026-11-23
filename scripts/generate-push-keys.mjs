#!/usr/bin/env node
/**
 * Prints a fresh VAPID key pair for web push, ready to paste into .env.local
 * and your Vercel environment variables.
 *
 *   node scripts/generate-push-keys.mjs
 */
import * as webpushModule from "web-push";

const webpush = webpushModule.default ?? webpushModule;
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local AND to your Vercel environment variables:

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com

The public key is safe to expose to browsers. Keep the private key server-side.
`);
