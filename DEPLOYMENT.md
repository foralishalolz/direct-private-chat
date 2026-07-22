# Deploying Direct

This walks through taking the app from your laptop to a live URL your friends can use, plus how to scale it later if the group grows.

---

## 1. Supabase setup (do this once)

1. Create a project at [supabase.com](https://supabase.com) if you haven't already.
2. Go to **SQL Editor** → paste in the full contents of `supabase/setup.sql` → **Run**. The script is safe to rerun if you ever need to.
3. Go to **Project Settings → API Keys** and copy three values:
   - **Project URL**
   - **anon / public key**
   - **service_role key** (click reveal — keep this one secret)

## 2. Local environment file

Create `.env.local` in the project root (this file is gitignored — it never gets committed):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SIGNUP_INVITE_CODE=pick-a-code-only-your-friends-know
```

## 3. Become the admin

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, click **Create account**, and sign up using your invite code. **You must be the very first account created** — the database automatically makes the first signup the admin ("god user"). Every signup after that is a regular user.

Go to `/admin` and confirm you can see the dashboard. Create a group or two, and add yourself to them so you can chat right away.

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a **private** repo on GitHub (github.com/new, don't initialize with a README), then:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

GitHub will ask for a username and password on push — use a **personal access token** as the password (Settings → Developer settings → Personal access tokens → Generate new token (classic), `repo` scope). Your real GitHub password won't work here.

## 5. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. **Add New → Project** → import your repo.
3. Before deploying, add the same four environment variables from your `.env.local` in the "Environment Variables" section:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SIGNUP_INVITE_CODE`
4. Click **Deploy**. You'll get a live URL like `your-app.vercel.app`.

Share that URL and the invite code with your friends. Their accounts will need to be added to groups by you (the admin) via `/admin` before they can see or chat in anything.

## 6. Ongoing admin tasks

All from `/admin` on your deployed URL:
- **Create a group**: name + optional description.
- **Delete a group**: removes it and its messages for everyone.
- **Give/remove someone's access to a group**: open "Manage groups" next to their name, check or uncheck groups, hit Save. Unchecking a group is how you ban someone from it — they lose access immediately, no separate ban step needed.

---

## Troubleshooting: "account created but can't sign in"

If sign-up succeeds but signing back in with the same username/password fails:

- **Check for extra characters.** Usernames are lowercased and stripped of anything but letters, numbers, dots, dashes, and underscores — if you typed something with spaces or capital letters at signup, what actually got saved may differ slightly from what you're typing at sign-in. Try signing up with a simpler username (letters and numbers only) to rule this out.
- **Check for a typo in the password**, especially if it has symbols — password managers and mobile keyboards autocorrect/autocapitalize in ways that can silently change what gets submitted.
- **Confirm your Supabase project doesn't restrict email domains.** This app creates accounts as `username@chat.local`, which is not a real, deliverable email address — some Supabase projects have an "allowed email domains" restriction under **Authentication → Settings** that could reject this. If your project has any such restriction enabled, either disable it or add `chat.local` to the allow-list.
- **Check the browser console and Network tab** (F12 → Console/Network) while attempting to sign in, and look at the response from the `signInWithPassword` call — the exact error message there (e.g. "Invalid login credentials" vs. something about email format) tells you which of the above it is.

If none of those explain it, capture the exact error message shown on-screen and in the browser console — that specifics is what narrows down the actual cause.

## Scaling beyond a small friend group

The app as built comfortably handles a small circle. If it grows toward hundreds or thousands of users (e.g. a whole school), a few things are worth upgrading — none are urgent at small scale, but flagging them honestly:

- **Signup rate limiting is in-memory.** It works per server instance, but Vercel can run multiple instances under load, and the limit resets on redeploys/cold starts. At real scale, swap it for a shared store like Upstash Redis (a few lines of code, free tier available).
- **Supabase connection pooling.** Supabase's default connection pooler (pgbouncer) handles this automatically for most plans — no action needed unless you outgrow the free tier, at which point Supabase's dashboard will tell you.
- **Realtime connection limits.** Supabase's free/pro tiers cap concurrent Realtime connections. If you're expecting thousands of simultaneously-open chat windows, check your plan's connection limit in the Supabase dashboard and upgrade if needed.
- **Indexes are already in place** for the access patterns this app uses (messages by group + time, memberships by user and by group), so query performance shouldn't degrade meaningfully as rows grow into the hundreds of thousands.

None of this requires re-architecting the app — it's config and infrastructure tuning on top of what's already built.
