# BitchAt 2.3

Next.js, TypeScript, Tailwind and Supabase. This branch connects to the existing BitchAt Supabase project using its public browser key. Private storage and database access are enforced by row-level security. No administrator key is included.

## Run

Node.js 22 or later:

```sh
git clone --branch bitchat-production --single-branch https://github.com/foralishalolz/direct-private-chat.git bitchat-production
cd bitchat-production
npm ci
npm run dev
```

## Check

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npx playwright test
npm start
```

## Deploy

This release is isolated on the `bitchat-production` branch. It includes the full Supabase schema, migrations, Edge Functions, Vercel configuration, and GitHub checks. The old branch is preserved.

In Vercel, import `foralishalolz/direct-private-chat`, set the production branch to `bitchat-production`, and use the repository root. Framework: Next.js. Install: `npm ci`. Build: `npm run build`. Output: `out`. The committed `vercel.json` contains these build settings and browser security headers. The Vercel connection must be authorized for the team owning the project; source files cannot grant that access.

Public connection settings are already in `lib/config.ts`; `.env.example` contains matching values for an optional `.env.local`. No administrator key belongs in the frontend. Database schema and Edge Functions in this repository are already installed on the connected project; do not rerun migrations to deploy the frontend. New database installations must use their own project URL and publishable key and configure the Edge Function secrets before accepting users.

`npm run build` also produces a portable `out/` directory. Serve that directory over HTTPS on a static host with directory-index routing. `/login/`, `/manifest.webmanifest`, `/sw.js`, and `/release.json` must be reachable. The app's Supabase authentication and private chat storage remain the same across frontend hosts. Browser sessions and offline caches belong to each origin, so a new address requires signing in again.

GitHub checks use the committed lockfile and attach the compiled website and browser test screenshots. The `Published website check` workflow is manual and targets Vercel; run it only after the Vercel deployment is available.

Use the login screen's Create account tab. Usernames use 3–24 lowercase letters, numbers or underscores; new passwords use 10–128 characters. Registration is rate limited and confirms internal username email addresses on the server. Settings accepts the configured server-side Pro PIN. Account recovery requires the project administrator because internal username addresses cannot receive email.

## Data behavior

Text remains in Supabase. IndexedDB stores up to 240 recent text messages per cached conversation, within a 40-entry/8 MB cache, for seven days. The outbox holds at most 100 messages and uses stable UUIDs to avoid duplicate sends. Logging out clears that user's local data. One-view photos, capsule payloads, and media blobs are excluded from offline snapshots. This is access-controlled messaging, not end-to-end encryption.

Media expires after 24 hours; capsule media expires 24 hours after unlock. A job every 15 minutes dispatches cleanup to an authenticated Edge Function, removes bytes through the Storage API, then nulls message media references. Failed deletions remain queued for retry. Active profile photos are retained. New one-view photos grant one claim per recipient, including group members. A sender can explicitly enable replay and saving for Pro viewers; it is off by default and the same 24-hour expiry still applies. Upgrading to Pro cannot reopen a strict one-view photo. Legacy photos keep their original claim behavior; a recipient can still take a screenshot or use another camera. Pro edited/deleted message history and unexpired deleted media remain visible to authorized Pro conversation members; delete-for-everyone does not erase that archive. Private journals never feed shared statistics. Couple prompts require both participants to enable Couple mode.

## Verification boundaries

GitHub Actions runs type checks, offline-storage/data tests, a production build, dependency checks, and desktop/mobile browser tests. Browser tests mock network responses and do not establish that every live Supabase integration works. Live end-to-end checks and the actual Vercel URL must be verified before describing a release as production-tested.

## Live release verification

The 2.4 release passed 79 live assertions on 2026-09-29, including regular-user edit/delete permissions, reaction inserts/changes/removal between mobile and desktop browsers, retained-history access rules, privacy settings, Storage uploads and offline delivery. It also passed 21 unit tests, 42 desktop/mobile browser checks, the production build, and the dependency audit with zero known vulnerabilities. Browser checks cover optimistic reactions and failed-request rollback, editing/deletion by a regular user, loading history while the realtime handshake is pending, and no message/reaction refetch while typing.

- [Live Supabase verification](https://github.com/foralishalolz/direct-private-chat/actions/runs/36514545115)
- [Build, browser and data verification](https://github.com/foralishalolz/direct-private-chat/actions/runs/36514545081)


The 2.2 live Supabase check passed 55 assertions, including two real browser sessions exchanging messages, reconnecting an offline outbox, actual Storage uploads, one-view consumption, server-enforced capsules, Pro authorization, and privacy boundaries. The test run also covered individual group instant views, replay consent, read-through boundaries, group invite revocation, ownership transfer, and per-user chat clearing. Test accounts and uploaded test media are removed after verification; existing chats are retained. The live workflow is manual because it creates disposable accounts in the connected project. Its QA_CLEANUP output identifies the exact test accounts and objects for an administrator to remove; normal CI uses isolated mocked data.

The 2.2 CI run also passed 19 unit tests, 32 desktop/mobile browser checks, the production build, and the dependency audit (zero known vulnerabilities).

## Version 2.4

Every conversation member can edit and delete their own sent messages. Database policies enforce authorship and membership for both regular and Pro accounts; editing another person's message is never allowed. Edited/deleted history remains restricted to Pro members of that conversation, and strict one-view photos are excluded from archives.

Each delivered message has a reaction icon with 24 emoji choices. Reactions appear optimistically, can be changed or removed, and roll back if the server rejects the action. Each person has one reaction per message. An authenticated, idempotent database function derives the reacting user from their session and uses narrow column permissions. Realtime inserts/updates are filtered to the conversation; deletes affect only known messages. Pagination fetches reactions only for newly loaded messages, and a successful local reaction reconciles only its message. Reconnects refresh the loaded window.

Opening a chat starts its HTTP snapshot after local hydration without waiting for the realtime handshake. Subscription catch-up still reconciles changes that arrive during loading. The message list is memoized separately from the composer, so typing does not rerender history or refetch messages/reactions. Private media still loads only near the viewport; existing offline and 24-hour media retention limits are unchanged.

## Version 2.3

Profile → Privacy controls online status, last-active time, typing, and read receipts separately. Preferences are enforced by Supabase for every viewer, including Pro members. Hidden receipts are removed from public conversation/member records; a private read marker keeps the owner's unread count accurate. Reenabling receipts shares the saved read position. Turning off both activity settings deletes the stored activity state. Activity heartbeats run only in visible tabs; tab sessions expire after 75 seconds and status refreshes at most every 30 seconds. Last-active time is approximate after a browser closes without delivering its final request.

Each privacy switch is saved separately under a database lock. Monotonic revisions prevent delayed HTTP responses or realtime events from restoring older settings, including changes made on another device.

Typing broadcasts are emitted by an authenticated database function, with the sender derived from the session and a per-conversation throttle. Client broadcasts cannot impersonate a sender. Typing expires after a few seconds and clears when a message arrives. Reconnecting and changing privacy settings cannot reorder a tab's activity updates. Pro members can edit or delete their own messages through the message menu or long press; recipients receive silent realtime updates. All action icons use the same rounded Lucide styling and accessible names.

## Version 2.2

Group owners and Pro members can rename a group, create a seven-day invite code, or revoke it. Members can leave; ownership passes to a remaining member. Groups accept up to 32 members through invitations. Delete chat clears only the caller’s history and hides the conversation until a new message arrives; it never erases another member’s copy. Read receipts advance only through a displayed message. Pro history begins when the corresponding migration is installed; earlier versions cannot be reconstructed. Media downloads are available only while the server still retains the bytes.

For the existing connected database, the 20260928 migrations are already applied. For a new Supabase project, use the complete schema and deploy the included Edge Functions. No secret key belongs in Vercel’s public environment variables.

## Security review

The new public tables have RLS enabled. Private payload/history tables intentionally have no client policies or table grants. The authenticated SECURITY DEFINER RPCs use an empty search path and check the caller's conversation membership and, where required, ownership or Pro status. The database linter flags those RPCs for review; their elevated execution is intentional. See [function review guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The connected project's leaked-password protection setting is currently disabled. Review [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before a wider public launch. This setting is separate from the app's minimum password length and registration rate limit.
