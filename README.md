# Direct — private real-time chat

A mobile-first, native-like private chat for a small circle of friends — groups, images & videos, couples, games, and push notifications. Built with Next.js 16 (App Router), Tailwind CSS v4, Supabase (Auth, PostgreSQL, Realtime, Storage), a web-push backend, and Lucide icons.

## What's new in v2

- **Beautiful, Instagram-like native UI** — gradient avatars, glassmorphism tab bar, bottom navigation (Chats / Couples / Profile), installable PWA with a real app icon and home-screen install prompt.
- **Images & videos** — send photos (up to 12 MB) and videos (up to 60 MB) in any group.
- **Couples** — link with your partner, get a playful **Kitten & Daddy** vibe, plan dates & outings, and send each other a "miss you" push notification.
- **Online games** — turn-based multiplayer tic-tac-toe (real-time, two players) with scores and a rematch button.
- **Push notifications** — web-push via VAPID when you get a new message or miss someone; notifications show the group name.
- **Faster on slow internet** — realtime channels with a polling fallback, optimistic sending with retry, day separators, and viewport-stable pagination.
- **Search** — search across groups, messages (with a highlight jump) and couple plans.
- **Polished admin dashboard** — create/delete groups, and grant/revoke group access per user (doubles as ban/unban per group).
- **Fixes** — media-only messages render correctly; role-based avatars and day/week separators; no-op scrollbar fixes.

## Getting started

```bash
npm install
npm run dev
```

Then open the app, sign up (first account becomes admin), create a group from `/admin`, add yourself to it, and invite others.

## One-time Supabase setup

1. Open **SQL Editor** in your Supabase dashboard and run `supabase/setup.sql` in full. It is idempotent and rerunnable.
2. On the first signup you're the admin.
3. (Optional) For web-push: in `/api/push` and your profile, you'll need the VAPID keys below.

### Web push (optional but recommended)

```bash
npx web-push generate-vapid-keys
```

Copy the two keys into your environment:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PUBLIC_KEY=<same public key>
VAPID_PRIVATE_KEY=<private key>   # keep secret — server-only
VAPID_SUBJECT=mailto:you@example.com
```

Then, in the app, go to **Profile** → turn on **Push notifications**. You'll get messages when friends send you something (when their client is online) and "miss you" pushes from your partner.

## Environment variables

See `.env.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SIGNUP_INVITE_CODE`. Optional: the four VAPID keys.

## Feature guide

### Groups & chat
- Text, photos and videos, optimistic sending with tick marks, edit your own messages, delete your own messages.
- Day separators, infinite scroll pagination, per-user avatar gradients.
- Live "Live / Reconnecting / Offline — polling" status in the header.

### Couples
- **Create a couple** — enter your partner's username (they don't need to do anything; they'll see it in their own Couples tab).
- **Kitten & Daddy** — each member picks a vibe (kitten / daddy) and sees each other's badge.
- **Plans** — date a night out, a brunch, a walk. Mark done, delete, and they show up live on both sides.
- **Miss you** — tap the button → push notification to your partner's devices.
- **Tic-Tac-Toe** — one board shared by both members, turn-based, scores, rematch.

### Search
- Search messages, groups and couples from the search bar at the top. Clicking a message opens the chat and scrolls to it.

### Admin (god mode)
- Only the first-created account can create/delete groups and manage user group access via `/admin`.

## Notes & honest limitations

- **Push notifications require the sender to be online** (or at least open at send time). A message sent while everyone is offline will not fire a push — that needs Supabase Edge Functions or a cron.
- **Private photos/videos are served from a public bucket** for speed. Don't put secrets in them. If you want private media, add signed-URL RLS.
- Signup rate limiting is in-memory and per-instance (5/hour/IP). For real scale, use Upstash Redis.
- This is not end-to-end encrypted — it's a private-circle chat, not a vault.

## Deploy

See `DEPLOYMENT.md`. The app is a standard Next.js app — Vercel works; any Node host works.

## Project structure

```
src/
  app/
    page.tsx            # Home shell (tabs)
    login/page.tsx      # Sign in / create account
    admin/page.tsx      # God-mode dashboard
    api/signup          # Signup with invite code + rate limit
    api/push            # Web-push sender (VAPID)
    api/couples         # Create couple (partner lookup)
    api/health          # Health check
  components/
    chat/               # ChatRoom, MessageBubble, GroupAvatar
    couples/            # CouplesView, TicTacToe
    BottomNav.tsx       # Native-like bottom tab bar
    ProfileView.tsx     # Profile + push toggle
    SearchOverlay.tsx   # Cross-entity search
    InstallPrompt.tsx   # beforeinstallprompt banner
    GroupList.tsx       # Conversations list
    ServiceWorkerRegistration.tsx
  lib/
    supabase.ts         # Browser client (guarded)
    supabaseAdmin.ts    # Server client (service role)
    push.ts             # Client push registration
    media.ts            # Upload validation + helpers
    requireAdmin.ts     # Admin guard for API routes
    requireUser.ts      # Auth guard for API routes
    format.ts           # Date/time helpers
public/
  sw.js                 # Push service worker
  manifest.webmanifest  # PWA manifest
  icons/                # App icons
supabase/
  setup.sql             # Full schema (idempotent)
  migrations/           # Incremental migration for existing DBs
```
