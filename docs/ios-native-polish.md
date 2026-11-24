# iOS native polish — 2.28

The supplied references live in `design/references/`: Apple Messages group thread, iOS text-formatting tray, and the dark iOS call screen. They are design references only; no private screenshot is used as a runtime asset.

## What changed

- Ported the mature call subsystem: private `call:<conversation>` signaling, early-ICE buffering, caller-only ICE restart, Cloudflare TURN, ringing and missed-call push jobs, call-sheet focus trap, wake lock, audio priming and call timeline cards.
- Ported the ink-only chat sketch overlay and shared drawing board. The composer now has one canonical tool per job instead of repeating chat activities in the attachment tray; quick affections are reachable from a dedicated tray entry rather than dead code.
- Added a real persisted iOS-style text-effects tray: Normal, Big, Small, Shake, Ripple, Bloom and Explode. Effects are a strict enum in `lib/textEffects.ts`, stored in `public.messages.text_effect`, preserved by the offline outbox, and validated by a database CHECK constraint. Unknown values never become CSS classes.
- Added `app/native-polish.css` as the final visual layer: system SF-style typography, native emoji font stack, layered glass, spring press feedback, reduced-motion/transparency/data-saver support, and a call-dock entrance.
- Fixed the phone keyboard / lower-chat scroll geometry: the app shell now uses `--app-height` with `--app-offset`, both scroll panes are `flex: 1 1 auto; min-height: 0`, and the mobile tab dock resets when returning to the inbox.
- Removed the stale checked-in `public/sw.js`. `scripts/build-shell.mjs` remains the single source of the production service worker and now generates `out/sw.js` from the call-aware `public/sw-template.js`.

## Call scope

This release is **audio-only**. The supplied dark call screen is used as the visual and interaction reference for a phone-style call sheet, not as a promise of FaceTime-style video. The client requests one audio track, shows a voice-call label, and keeps the existing `audio` kind in `start_call`. The database accepts `video` for future work, but no video capture, preview, aspect-ratio handling, camera switching, or two-way video UI is included in 2.28.

## Production checks

Run `npm run typecheck`, `npm test`, `npm run build`, and `npx playwright test`. The unit suite includes strict effect normalization, persistence through direct/optimistic sends, database constraint parity, and the scroll-geometry fix. Browser tests include a new text-effects round trip through the outbox.

The connected Supabase project already has the call, realtime, push, and TURN schema/functions. The 2.28 additive migration only adds `messages.text_effect`; apply it before deploying. Cloudflare TURN secrets and VAPID Vault secrets were verified by name, not by value.

Physical-device verification remains necessary for OS notification permission, locked-screen ringing, microphone permission, and a two-phone call on mobile data; mocked browser tests cannot prove those platform behaviours.
