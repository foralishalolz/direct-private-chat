## Summary

Turns the text-only Telegram-style clone into **BitchAt v2**: an installable, media-rich, couple-focused real-time chat with web push. Three commits on `arena/61c98ff8-direct-private-chat`.

## 🎨 UI overhaul (Instagram-inspired)
- New design system (`globals.css`): plum background, rose→violet gradient accents, glass surfaces, story-ring avatars, skeletons, safe-area-aware layout, reduced-motion support.
- Native-style shell with **Chats / Us / Search** tabs, unread badges, bottom sheets, offline banner, haptics.
- Rebuilt login (floating hearts, show/hide password, invite code), inbox split into *Just us* / *Circles*, and a full admin dashboard redesign with stats + custom checkbox access control.
- Installable PWA: `manifest.webmanifest`, generated icon set (incl. maskable), `/offline` fallback, service worker registration.

## ⚡ Chat that survives bad internet
- **Optimistic outbox** (`useOutbox`): instant render, `localStorage` persistence, order-preserving retries with exponential backoff, reference-guarded drains (no double sends), auto-flush on `online`/visibility change, tap-to-retry on failure, "sending" settles even when the realtime socket is asleep.
- Realtime messages + broadcast typing + presence; read receipts (✓✓), reactions, reply threading, edit/delete, viewport-stable pagination.
- **Media**: in-browser WebP compression for photos, video up to 50 MB, **voice notes** (MediaRecorder), stickers, lightbox.
- **Search** across message text, chats and people (debounced, permission-scoped).

## 💗 Couple features
- Private 1:1 chats, server-created, readable only by the two members (RLS-enforced; no admin bypass).
- **Kitten / Dada** roles on the profile with a themed *Us* hub.
- **Pokes** (miss you / kiss / hug) with hourly rate limits, **love notes** with prompts, **scheduled plans** with live countdowns.

## 🎮 Multiplayer games
Six games synced over a per-session `jsonb` row: Would You Rather, This or That, Truth or Dare, Two Truths & a Lie, Tic-Tac-Toe, Connect 4.

## 🔔 Push notifications
- VAPID web push, service worker with offline shell + media caching, notification deep links (`/?open=<groupId>`).
- Per-message fan-out (`/api/push/notify`) re-reads the message with the service role so content can't be spoofed; respects per-chat mutes; dedupes via `push_deliveries`.
- Cron sweeper (`vercel.json`, every 10 min): plan reminders 15 min before a date, plus a "someone misses you" nudge (max once per 12 h).
- iOS install guidance baked into the notification sheet.

## 🗄️ Data layer
- `supabase/setup.sql` v2 (idempotent): media columns, reactions, reads, typing, presence, plans, love notes, games, push tables, `chat-media` storage bucket + policies, realtime publication entries.
- RLS helper functions (`is_admin`, `is_member`, `shares_group_with`), narrow column-level grants, and legacy constraint cleanup so media-only messages work.
- Fixed three latent SQL issues found in review: stale non-blank constraint on `messages` in the shared upgrade path, missing `id`/`status` grant on `game_sessions`, and `storage.objects.owner` text/uuid cast.

## ✅ Verification
- `npx tsc --noEmit` clean, `npx eslint .` **0 errors**, `npx next build` succeeds (all routes compile).
- Route smoke tests return 200: `/`, `/login`, `/offline`, `/manifest.webmanifest`, `/sw.js`, `/admin`, `/icons/*`.
- ⚠️ No headless browser in the sandbox, so no screenshot pass — worth clicking through on a phone before sharing.

## ⚠️ Required before deploying
1. **Rerun `supabase/setup.sql`** in the Supabase SQL editor (adds the new tables/bucket; existing data is preserved).
2. Add env vars in Vercel: `npm run push:keys` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`, plus `CRON_SECRET`. See `DEPLOYMENT.md` / `README.md`.

Closes nothing — purely additive feature work.
