# Direct — private multi-group chat

A mobile-first, Telegram-style real-time chat for a private circle, organized into admin-managed groups. Text messages only — no media uploads. Built with Next.js 16 (App Router), Tailwind CSS v4, Supabase (Auth, PostgreSQL, Realtime), and Lucide icons.

## Supabase credentials used

Configured in `.env` or `.env.local` (either name works — Next.js reads both):

- `NEXT_PUBLIC_SUPABASE_URL=https://your-project-reference.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key`
- `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key` (server-only, never exposed to the browser)
- `SIGNUP_INVITE_CODE=your-chosen-invite-code` (server-only; required to create an account — share it only with people you want in the chat)

See `DEPLOYMENT.md` for the full setup and deploy walkthrough.

## One-time Supabase setup

1. Open **SQL Editor** in your Supabase dashboard and run `supabase/setup.sql` in full. It's written to be safely rerunnable.
2. No email confirmation toggle change is required — the sign-up API route creates users with `email_confirm: true` via the service role, so `@chat.local` addresses never block login.
3. **Sign up first, before anyone else.** The very first account ever created automatically becomes the admin ("god user") — this is handled by a database trigger, not a setting.

## What the app does

- **Sign in / Sign up** on one screen. Usernames are normalized and suffixed with `@chat.local` internally; passwords are created server-side with auto-confirmation. Sign-up requires a correct invite code (`SIGNUP_INVITE_CODE`), an 8+ character password with a letter and a number, and is rate-limited to 2 accounts per hour per IP.
- **Groups** — the admin creates groups (e.g. "Clash of Clans", "Valorant", "Study material") from `/admin`. A user only sees and can chat in groups the admin has added them to. The home screen is a group list; tapping a group opens its chat, with a back button to return.
- **God mode admin dashboard** (`/admin`, admin-only): create and delete groups, and for every user, a "Manage groups" control listing every group with a checkbox — checking a box grants that user access, unchecking it removes access immediately. This is also how you ban/unban someone from a specific group.
- **Real-time chat** via Supabase Realtime (INSERT / UPDATE / DELETE), scoped per group, with 30-message infinite scroll and viewport-stable pagination.
- **Text only** — no images, video, or file uploads of any kind.
- **Row Level Security** enforces: a user can only read/write messages in groups they belong to (or any group, if admin); only the author can edit/delete their own messages; all group/membership writes go through service-role admin API routes, never directly from the browser — so even a modified client can't grant itself group access.
- **Dark, Telegram-style interface** throughout — chat, group list, admin dashboard, and login screen.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL, sign up (you'll become admin automatically as the first account), create a group or two from `/admin`, add your own account to them, then invite others.
