# BitchAt 2.8

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

In Vercel, import `foralishalolz/direct-private-chat`, set the production branch to `bitchat-production`, and use the repository root. Framework preset: **Other**. Install: `npm ci --no-fund`. Build: `npm run build`. Output: `out`. The app uses Next.js to generate static files; Vercel serves that export directly. The committed `vercel.json` explicitly sets `framework: null` (Other), overriding the dashboard preset. Using the Next.js adapter together with an `out` output override makes it look for `out/routes-manifest.json`, which is not part of a static export. The committed settings also preserve the generated service worker and browser security headers. The Vercel connection must be authorized for the team owning the project; source files cannot grant that access.

Public connection settings are already in `lib/config.ts`; `.env.example` contains matching values for an optional `.env.local`. No administrator key belongs in the frontend. Database schema and Edge Functions in this repository are already installed on the connected project; do not rerun migrations to deploy the frontend. New database installations must use their own project URL and publishable key and configure the Edge Function secrets before accepting users.

`npm run build` also produces a portable `out/` directory. Serve that directory over HTTPS on a static host with directory-index routing. `/login/`, `/manifest.webmanifest`, `/sw.js`, and `/release.json` must be reachable. The app's Supabase authentication and private chat storage remain the same across frontend hosts. Browser sessions and offline caches belong to each origin, so a new address requires signing in again.

GitHub checks use the committed lockfile and attach the compiled website and browser test screenshots. The `Published website check` workflow runs when a release is published on the production branch, waits for Vercel to serve that version, and checks the public login, account creation, icons, and offline shell. It can also be run manually.

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

## Version 2.8

Next.js is pinned to 16.3.8, including the next/og ImageResponse security fix. The lockfile is regenerated and production dependencies are checked by CI. The application exports static files and does not expose an ImageResponse endpoint. Seventeen live, rolled-back SQL checks verify shared treat polls, idempotent creation, authenticated choices, expiry, and outsider rejection; see `supabase/tests/couple_moments.sql`.

The interface uses a system-font glass design with rounded panels, a floating mobile navigation dock, safe-area-aware chat controls, keyboard-aware viewport sizing, and swipe-down bottom sheets. Sheets isolate and trap focus inside the active dialog. Animations are short and limited to opacity/transform; reduced-motion and reduced-transparency preferences are respected. Data saver disables expensive backdrop effects, reduces image resolution and compression size, and limits offscreen media loading. Emoji rendering follows the device's native font.

Kiss/hug requests include a reply action that preserves the text draft. Muahh, ILY, and food gifts remain readable, exportable messages. Both people must enable couple mode to open Us. Sweet match uses the existing authenticated poll/vote functions for shared treat choices; matching choices award bounded, account-scoped local cosmetic stamps. No camera/microphone privacy override or explicit sexual content is included.

Slow sends remain visible immediately in the existing bounded IndexedDB outbox. New drafts drain immediately after an in-flight send finishes, with stable UUID retries and account-level ordering. Inbox previews update locally instead of waiting for a full HTTP snapshot; delayed responses retain newer previews, read markers, and archive choices. Realtime HTTP reconciliation and local cache writes are coalesced. Older iOS browsers without AbortSignal.any keep request cancellation and deadlines. Rapid sticker saves use a transaction-scoped monotonic timestamp so FIFO eviction remains deterministic even within one millisecond.

The inbox bell opens notification settings directly. Permission is requested only by tapping Message alerts; the existing Supabase Web Push queue and service worker handle background delivery. The browser checks cover opt-in, failure rollback, slow sends, modal gestures, reduced motion, data saver, couple matching, and permission boundaries. Physical-device notification delivery still requires supported OS/browser settings; mobile browser simulation does not verify the phone's notification center.

## Version 2.7

The Affection tray sends kisses, hugs, love, and I-miss-you messages without discarding a typed draft or reply. Each is a normal readable message, so realtime delivery, offline retries, search, export, reactions, editing, and deletion use the existing chat paths. The thread also has an I miss you shortcut. Both participants must enable Couple mode for the romantic bubble styling and Pick our date game. Effects are brief and respect reduced-motion preferences.

Swipe a message right to reply. Horizontal movement uses animation-frame DOM updates without rerendering the message list; vertical gestures retain native scrolling. Short, cancelled, and vertical gestures cannot select a reply, and controls inside a message keep their normal behavior. Reply remains available in the message menu. The composer focuses on the reply gesture and preserves its draft.

Strict instant photos close and clear their canvas pixels on a subsequent screen touch, a delivered keyboard event, focus loss, backgrounding, printing, or close. Late image decoding cannot restore wiped pixels. Browser pages cannot reliably observe phone power/volume buttons or prevent operating-system screenshots; these dismissal measures are not screenshot protection. Pro replay and saving still require the sender's explicit choice.

Notifications now use real Web Push, including when no app tab is open on a supported device. Enable Message alerts in Profile → Notifications; iPhone requires a supported Home Screen installation. Permission is requested only after a tap. Registration is scoped to the signed-in account, and disabling alerts or signing out unsubscribes the device and clears its local notification owner. The service worker shows only a generic New message alert and validates the intended account before opening a conversation.

The live `20260930082838_private_web_push_delivery` migration and `push-notifications` Edge Function implement a private, coalescing delivery queue with recipient membership, blocking, archive, clearing, read-marker, and expiry checks. VAPID keys and the worker secret stay in Supabase Vault. Queue errors do not interrupt message inserts. Deliveries use bounded leases, retries, timeouts, and invalid-endpoint removal; a one-minute cron recovers queued work. Physical-device delivery depends on browser support, notification permission, and the device's operating-system settings. The service worker caches app assets only and retains one previous shell's immutable chunks so an update does not force a reload or discard an open draft.

## Version 2.6

Inbox rows reveal Archive and Delete when swiped left. Right-click or focus a row and press Left Arrow for the same actions; Escape or Right Arrow closes them. Vertical movement keeps native list scrolling and cannot delete a chat. Only one row is revealed at a time. Deletion still requires confirmation and clears only the caller's history. The Archived tab exposes saved conversations; swiping one reveals Unarchive. Archive state is stored per authenticated account, stays archived when new messages arrive, and synchronizes across devices. Archiving preserves all text, queued sends, and the other participants' inboxes. Failed archive requests leave the row intact. Existing media retention and privacy rules are unchanged.

Sticker previews and received stickers now have a visible Save action. Saved collections remain private to the account on that browser. One-view canvas pixels are cleared synchronously on focus loss, page hiding, and close; delayed decoding cannot redraw a dismissed photo. Print layouts omit the viewer. These measures do not block operating-system screenshots or recipient-controlled capture. Camera and microphone use always require a visible, intentional action. Pro cannot override privacy, blocking, or strict one-view permissions.

## Version 2.5

The composer owns its draft and emoji state separately from the chat screen. Keystrokes no longer rerender the thread, textarea sizing is batched with animation frames, and a delayed send cannot clear newer draft text. IME composition is preserved; desktop Enter sends, Shift+Enter inserts a line, and touch keyboards retain multiline input. The voice note icon is smaller while retaining a 44-pixel touch target. Emoji controls work on mobile.

New group and Join group are visible in the inbox. Each chat has a Delete chat action with confirmation; Delete chat and Leave group also appear directly in the thread menu. Deletion clears only the caller's messages and queued sends. Group exit remains enforced by the database.

Stickers can be created, saved, reused, and removed locally, including received stickers that are still available on the server. Photo stickers are cropped to a 512 × 512 square. IndexedDB keeps separate collections per account, with content deduplication, 60 stickers/16 MB per account, 512 KB per sticker, and a 32 MB device budget. Collections survive logout; private text caches are still cleared. They are device-local and clearing browser storage removes them.

Instant cameras offer hardware torch when supported and screen flash otherwise. Leaving the app stops the camera; returning requires a Resume camera tap. Streams are stopped on close and camera switches. Strict instant viewers render bytes to canvas with no image URL or link in the DOM, clear their pixels on close, and close on backgrounding. Ordinary photos remain inline. No browser can guarantee prevention of OS screenshots, external recording, or capture by a recipient who controls their device. Strict instants remain one-view for Pro; replay/save requires the sender's explicit choice.

Version 2.5 introduced opt-in, generic alerts while an app tab remained running. Version 2.7 replaces the background-tab delivery path with the Web Push backend described above; visible in-app alerts continue to use Realtime.

The connected project's Pro password was rotated on 2026-09-30. Its plaintext is never included in application source, database migrations, or client bundles. New database installs seed an unusable random password until an administrator configures their own hash. Live Pro QA requires the private `BITCHAT_QA_PRO_CODE` environment variable (or GitHub Actions secret); it fails before creating test accounts if the variable is missing. Existing Pro accounts remain Pro. Pro access does not override other people's blocking/privacy settings, strict one-view consent, or camera/microphone permissions.

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
