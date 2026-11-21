# BitchAt — a private chat built for two (or your tiny circle)

A mobile-first, installable real-time chat with a warm Instagram-inspired UI.
Text, photos, videos, voice notes and stickers; typing indicators, read receipts
and reactions; scheduled dates, love notes and six real-time multiplayer games;
and web push notifications that actually reach you when the app is closed.

Built with **Next.js 16 (App Router)**, **React 19**, **Tailwind CSS v4**,
**Supabase** (Auth, Postgres, Realtime, Storage) and **Web Push (VAPID)**.

---

## What's inside

### Chat that feels instant, even on bad internet
- **Optimistic outbox** — sending never waits on the network. Messages are
  queued in `localStorage`, rendered immediately, retried with exponential
  backoff, and flushed automatically when connectivity returns or the tab
  regains focus. A failed message becomes a tappable "retry" row.
- **Supabase Realtime** for inserts/updates/deletes, plus broadcast typing
  indicators and presence (who's online right now).
- **Media** — photos are resized/compressed in the browser to WebP before
  upload (a 6 MB camera photo lands around 200 KB), videos up to 50 MB, GIFs
  left animated. Voice notes record straight from the mic.
- **Reactions** (long-press a bubble), **reply threading**, **read receipts**
  (single/double ticks), **edit & delete**, **stickers**, and full-screen photo
  viewer.
- **Pagination** — 30-message pages with viewport-stable infinite scroll.
- **Optimistic offline shell** — a service worker caches the app shell and chat
  media, so reopening a chat on a patchy connection shows your history
  instantly and an `/offline` fallback when the network is fully gone.

### Built for couples
- **Direct "just us" chats** — created with one tap, readable only by the two
  people in them (RLS enforces it; admins cannot grant themselves access).
- **Kitten / Dada roles** — pick yours from your profile; the "Us" tab re-themes
  around it with soft pet names and nudges.
- **Pokes** — one-tap 💗 *miss you*, 💋 *kiss*, 🫂 *hug*. Each delivers a push
  notification, rate-limited so it stays sweet rather than spammy.
- **Love notes** — prompt-driven notes only your person can read, with live
  delivery notifications.
- **Plan dates** — schedule dates, calls, movie nights, trips and game nights
  with duration, place and notes. Upcoming plans count down, and a cron sweep
  pushes a "starting in 15 minutes" reminder to both of you.
- **Games** — six real-time multiplayer games sharing a single `jsonb` state row
  per session, so turns sync over Realtime the instant they happen:
  Would You Rather, This or That, Truth or Dare, Two Truths & a Lie,
  Tic-Tac-Toe and Connect 4.

### Notifications
- **Web Push via VAPID** — `manifest.webmanifest` + service worker make the app
  installable, and push works on Android/desktop and on iOS once added to the
  Home Screen.
- Per-message fan-out (`/api/push/notify`) re-reads the message server-side so
  content can't be spoofed, respects per-chat mutes, and deduplicates with a
  `push_deliveries` ledger.
- **"Someone misses you"** — a cron sweep nudges people who have unread messages
  older than an hour, at most once per 12 hours.
- **Plan reminders** — 15-minute warning before a scheduled date.
- In-app chimes, haptics and a live unread badge, plus an optional push opt-in
  card and a notification sheet that explains iOS install steps.

### Search & navigation
- Global search across message text, chat names and people (debounced,
  `ilike`-powered, permission-scoped to your chats).
- Three-tab native-style shell — **Chats / Us / Search** — with unread badges,
  story-ring avatars, skeleton loaders and safe-area-aware layout.

### Admin
- First account on a fresh install becomes the admin (god mode).
- `/admin` creates and deletes circles, shows people and their access, and
  toggles per-circle membership with a checkbox (unchecking = instant revoke).

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run **all of `supabase/setup.sql`**. It's idempotent —
   safe to rerun after pulling new changes; it adds what's missing without
   touching your data. It also creates the `chat-media` storage bucket and its
   policies, and adds every table to the Realtime publication.
3. Copy **Project URL**, **anon key** and **service_role key** from
   *Project Settings → API*.
4. Sign up immediately — the first account becomes the admin.

> Upgrading from the old text-only version? Run the script again. Existing
> messages are preserved; new columns (media, reactions, plans…) are added in
> place.

## Environment variables

Create `.env.local` (gitignored) and add the same values in Vercel:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SIGNUP_INVITE_CODE=pick-a-code-only-your-friends-know

# Web push — generate once with: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com

# Protects /api/cron/reminders
CRON_SECRET=any-long-random-string
```

Push and cron are optional: without VAPID keys the app runs fine and simply
doesn't offer notifications. Without `CRON_SECRET` the reminders route is open
(use a secret in production).

## Run locally

```bash
npm install
npm run dev
```

Open the URL, sign up (you become admin), create a circle in `/admin`, add
yourself, then invite people with the invite code.

## Deploy

1. Push to GitHub and import the repo in Vercel.
2. Add every environment variable above.
3. Deploy. `vercel.json` registers the `/api/cron/reminders` cron (every 10
   minutes) — Vercel sends `CRON_SECRET` automatically as a bearer token when
   the value matches.
4. On iPhone: Safari → Share → *Add to Home Screen* → open from the Home Screen
   → enable notifications in the bell menu.

## Useful commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npx web-push generate-vapid-keys   # fresh push keys
```

## Security model (short version)

- **RLS everywhere.** You can only read messages and profiles in chats you
  belong to; profiles are visible only to people who share a circle with you.
- **Writes are narrow.** Group/membership writes go through service-role API
  routes; the browser can only insert its own messages, its own reactions/reads,
  its own presence, and edit/delete what it authored.
- **Direct chats are private.** Membership is created server-side and no policy
  lets a third party (including admins) add themselves.
- **Push fan-out is verified server-side** — re-reads the message, checks the
  caller is the author, respects mutes, and never leaks content to non-members.
