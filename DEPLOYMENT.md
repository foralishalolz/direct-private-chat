# Deploying BitchAt

From your laptop to a live URL your people can install as an app.

---

## 1. Supabase (do this once)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor →** paste the entire contents of `supabase/setup.sql` **→ Run**.
   The script is idempotent: rerun it any time you pull new code and it will add
   whatever is missing. It creates:
   - every table (profiles, groups, messages, reactions, reads, typing,
     presence, plans, love notes, games, push subscriptions),
   - all Row Level Security policies and grants,
   - the `chat-media` storage bucket + upload policies,
   - Realtime publication entries for the live tables.
3. **Project Settings → API Keys:** copy the Project URL, the anon/public key
   and the service_role key.

## 2. Environment variables

`.env.local` locally, and the same set in Vercel → *Settings → Environment
Variables*:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SIGNUP_INVITE_CODE=pick-a-code-only-your-friends-know
```

**For notifications** (optional but recommended):

```bash
npx web-push generate-vapid-keys
```

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=<long random string>
```

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is safe in the browser. The private key must stay
server-side only. After adding them, redeploy — the browser needs the public key
at build time.

## 3. Become the admin

```bash
npm install
npm run dev
```

Open the app, **Create account** with your invite code. The *very first* account
ever created is promoted to admin automatically by a database trigger. Create a
circle in `/admin`, add yourself, and start chatting.

## 4. Deploy to Vercel

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → **Add New → Project** → import it.
3. Add all environment variables before the first deploy.
4. Deploy. `vercel.json` already registers the reminders cron:

   ```json
   { "crons": [{ "path": "/api/cron/reminders", "schedule": "*/10 * * * *" }] }
   ```

   Vercel invokes it every 10 minutes with `Authorization: Bearer $CRON_SECRET`
   when that variable exists. It sends:
   - plan reminders 15 minutes before a scheduled date,
   - a gentle "someone misses you" ping for unread messages older than an hour.

   *(Hobby plans run crons once a day — the reminders still work, just less
   tightly timed. Pro/Enterprise run every 10 minutes as configured.)*

## 5. Installing on phones

- **Android / desktop Chrome, Edge:** open the site → browser menu →
  *Install app* (or the install icon in the address bar).
- **iPhone / iPad:** must use **Safari** → Share → *Add to Home Screen*, then
  open BitchAt from the Home Screen icon and enable notifications from the bell.

iOS only supports web push for Home-Screen-installed apps, so the app detects
that case and shows the exact steps.

## 6. Ongoing admin tasks

All from `/admin`:
- **Create a circle** — name + optional description.
- **Delete a circle** — removes it and its messages for everyone.
- **Grant / revoke access** — open *Access* next to a person and check or
  uncheck circles. Unchecking is an instant revoke; there's no separate ban.

Private 1:1 chats are created by users themselves and are readable only by the
two people in them — no admin access, by design.

---

## Troubleshooting

**"Account created but can't sign in."**
- Usernames are lowercased and stripped to `[a-z0-9._-]`; check for stray
  characters or autocapitalization.
- Password managers occasionally submit an old password — retype it.
- Some Supabase projects restrict allowed email domains. Accounts are
  `username@chat.local`, so if *Authentication → Settings* has a domain
  allow-list, add `chat.local`.
- Open DevTools → Network and inspect the `signInWithPassword` response; the
  exact error message identifies which of the above it is.

**"Media storage isn't set up yet."**
Rerun `supabase/setup.sql` — it creates the `chat-media` bucket and policies.
Check *Storage* in the dashboard to confirm it exists and is public.

**Photos won't upload on mobile.**
Check the bucket's `file_size_limit` (50 MB in the script) and that the file is
an allowed type. Photos are compressed in-browser before upload, so a slow
connection mostly affects large videos.

**No push notifications.**
- Confirm both VAPID variables exist in the deployment.
- iOS: must be installed to the Home Screen, and notifications enabled from the
  bell menu *after* installing.
- Desktop: check the site's notification permission in browser settings.
- The subscription row lives in `push_subscriptions` — confirm it appears after
  enabling.

**Notifications stop after a while.**
Expired subscriptions are pruned automatically on `410 Gone`. Reopen the app and
toggle notifications off/on to re-register the device.

## Scaling notes

- **Signup rate limiting is in-memory** (5 accounts/hour/IP). Fine for a small
  circle; swap for Upstash Redis if you ever open signups publicly.
- **Realtime connections** — Supabase caps concurrent connections per plan.
  Each open chat window holds one channel plus a presence channel.
- **Media** lives in Supabase Storage (public bucket). If you expect heavy
  video traffic, put a CDN in front of the bucket.
- **Indexes** cover messages by `(group_id, created_at desc, id desc)` and
  memberships by user and group, so performance holds as history grows.
