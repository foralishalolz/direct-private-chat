# BitchAt

Next.js, TypeScript, Tailwind and Supabase. This branch connects to the existing BitchAt Supabase project using its public browser key. Private storage and database access are enforced by row-level security. No administrator key is included.

## Run

Node.js 22 or later:

```sh
git clone --branch bitchat-live --single-branch https://github.com/foralishalolz/direct-private-chat.git
cd direct-private-chat
npm install
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

Import this repository's `bitchat-live` branch in Vercel. Framework: Next.js. Root: repository root. Build: `npm run build`. Output: `out`. Public connection settings are already in `lib/config.ts`; environment variables may override them. No paid plan is required by the app. Database schema and Edge Functions in this repository are already installed on the connected project; do not rerun migrations to deploy the frontend.

Use the login screen's Create account tab. Usernames use 3–24 lowercase letters, numbers or underscores; new passwords use 10–128 characters. Registration is rate limited and confirms internal username email addresses on the server. Settings accepts the configured server-side Pro PIN. Account recovery requires the project administrator because internal username addresses cannot receive email.

## Data behavior

Text remains in Supabase. IndexedDB stores up to 240 recent text messages per cached conversation, within a 40-entry/8 MB cache, for seven days. The outbox holds at most 100 messages and uses stable UUIDs to avoid duplicate sends. Logging out clears that user's local data. One-view photos, capsule payloads, and media blobs are excluded from offline snapshots. This is access-controlled messaging, not end-to-end encryption.

Media expires after 24 hours; capsule media expires 24 hours after unlock. A job every 15 minutes dispatches cleanup to an authenticated Edge Function, removes bytes through the Storage API, then nulls message media references. Failed deletions remain queued for retry. Active profile photos are retained. The one-view server grants a single claim; a recipient can still take a screenshot or use another camera. Pro deleted-text history remains visible to authorized Pro conversation members; delete-for-everyone does not erase that archive. Private journals never feed shared statistics. Couple prompts require both participants to enable Couple mode.

## Verification boundaries

GitHub Actions runs type checks, offline-storage/data tests, a production build, dependency checks, and desktop/mobile browser tests. Browser tests mock network responses and do not establish that every live Supabase integration works. Live end-to-end checks and the actual Vercel URL must be verified before describing a release as production-tested.

## Live release verification

The live Supabase check passed 35 assertions, including two real browser sessions exchanging messages, reconnecting an offline outbox, actual Storage uploads, one-view consumption, server-enforced capsules, Pro authorization, and privacy boundaries. The cleanup worker also removed a queued test file through the Storage API (HTTP 200, one deleted, zero failures). Test accounts and uploaded test media are removed after verification; existing chats are retained. The live workflow is manual because it creates disposable accounts in the connected project. Its QA_CLEANUP output identifies the exact test accounts and objects for an administrator to remove; normal CI uses isolated mocked data.
