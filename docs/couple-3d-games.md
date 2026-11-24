# Couple-themed 3D games (2.29)

BitchAt 2.29 adds three original, procedural 3D worlds for two people in a private chat. They are reachable from **Play → 3D together** and through the shared-activity ping, which pulls the partner into the same round. The games are couple-themed rather than generic shooters:

| World | Couple theme | Rule |
| --- | --- | --- |
| **Promise Orbits** | Six promise hearts float around a tiny moonlit planet. | Either person can collect any heart; the higher score wins. |
| **Moonlit Garden** | A low-poly garden of flowers and shared blooms. | Both avatars must be near the same bloom. The round is a shared win with no loser. |
| **Starlight Rally** | A glowing constellation trail. | Only the next star is live; first to four hearts wins. |

All three use one WebGL scene, keyboard/WASD controls and an on-screen touch pad. A **Heart list** view keeps the round playable on devices without WebGL. Reduced-motion users get calmer camera and heart-bob animation; reduced-transparency users get opaque glass.

## Open-source research

GitHub repository metadata and license files were checked with the GitHub API on 2026-11-24. The implementation does **not** copy repository code, models, textures, audio or CDN-loaded HTML. It adapts the ideas into original TypeScript/Three.js code and credits the projects:

| Project | License | Interesting idea | Why it needed adapting |
| --- | --- | --- | --- |
| [webgl-games/arcade-3d](https://github.com/webgl-games/arcade-3d) | MIT | Five 3D browser games, including a curved tiny planet, rocket mission and co-op destruction; procedural geometry and no downloaded assets. | Its standalone pages load Three.js from a CDN and multiplayer uses a long-lived WebSocket relay. This app is a static `out/` export with `script-src 'self'`, so Three.js is an npm dependency bundled locally. |
| [assishmoncs/polyworld-arena](https://github.com/assishmoncs/polyworld-arena) | MIT | Three.js/React/TypeScript low-poly open world, vehicles, social sandbox and multiplayer layers. | Socket.IO needs a separate authoritative server. Positions here use Supabase Realtime broadcasts instead, with no extra service to host. |
| [DevanMetz/openrp](https://github.com/DevanMetz/openrp) | MIT | Three.js city roleplay with server simulation and entirely original generated assets. | Its Cloudflare Worker/Durable Object backend is not part of this static Vercel project. The idea of a fully procedural, asset-free world is reused. |
| [dmitrymorozoff/xtanks](https://github.com/dmitrymorozoff/xtanks) | MIT | Early Three.js/Node 3D multiplayer movement. | Its Node server is not compatible with the static export; movement and collection were reimplemented for two players. |

Projects not used: `nickyvanurk/voidfall` reports `NOASSERTION` rather than a clear license, `Nta0039/island-fishing` publishes no license, and `rameshvarun/netplayjs` is ISC but bundles third-party assets with mixed terms. `three@0.187.0` and `@types/three@0.187.0` come from npm and are bundled by the production build; no game script, font, model or texture is fetched at runtime.

## Architecture

- `components/Couple3DArcade.tsx` owns the sheet, round selection, score HUD, accessible heart list and Supabase Realtime channel.
- `components/Couple3DScene.tsx` is dynamically imported with `ssr:false`. It builds the Three.js camera, lighting, avatars, hearts, stars and mode-specific scenery from geometry primitives. It disposes geometries, materials and the WebGL context on unmount.
- `lib/couple3d.ts` holds pure layout, movement, proximity, result and broadcast-validation rules so they can be unit tested without WebGL.
- `app/couple3d.css` is another local CSS layer; it uses safe-area-aware rounded glass, touch targets and the existing dark iOS palette.
- `components/Activities.tsx`, `hooks/useActivityPing.tsx` and `components/ChatRoom.tsx` add the `arcade3d` activity tab and partner join banner.
- `supabase/migrations/20261124130000_couple_3d_arcade.sql` and `20261124130100_couple_3d_rules.sql` are the canonical additive migrations; their final definitions are also concatenated into `supabase/schema.sql`.

### Live transport and database safety

Round creation, ending and heart collection call SECURITY DEFINER RPCs. They verify the caller is one of the two direct-chat members, lock the round row, reject stale round IDs and validate item IDs. The `couple_3d_match` table has RLS with member-only SELECT; clients receive no INSERT/UPDATE grant. The `open_activity` kind `arcade3d` lets the partner's device open the same sheet.

High-frequency avatar positions are **ephemeral** `couple3d:<conversation-id>` Realtime broadcasts, not database rows. A dedicated `realtime.messages` policy requires `userId = auth.uid()`, a matching UUID round, a payload under 512 bytes, bounded world coordinates and a small allowlist of event types. The client independently validates inbound broadcasts. A 3-second REST poll covers dropped postgres-change sockets; a 2-second sync heartbeat covers a late-joining partner.

The first connector migration recorded as `couple_3d_arcade` was an empty comment-only entry caused by SQL line comments being flattened before submission; it changed no objects. The actual schema was verified after `couple_3d_arcade_apply`, and rally/garden rules after `couple_3d_rules`. Remote migration timestamps differ from local filenames, as with earlier call and text-effect migrations; do not blindly replay local files against the connected project.

## Verification

- `npm run typecheck`
- `npm test` — 85 unit tests, including the 3D rules, SQL guards, CSP and activity wiring.
- `npm run build` — static `out/` export, generated `out/sw.js` and `out/build-info.json`.
- `npx playwright test` — includes a mocked 3D start/collection test that forces the WebGL fallback and checks no page errors or horizontal overflow.

Browser tests mock REST and Realtime. Physical-device checks still required: two phones on separate networks receiving each other's avatar positions, WebGL on older iOS devices, locked-screen activity pings, microphone/TURN calls and Web Push delivery. Calls remain audio-only; the 3D games do not enable video.

## Verified production deployment

Version 2.29.0 was built from `arena/e5c8434f-direct-private-chat` commit `361c267bd290ff8b5759914746f5fdf48f1a3010` and promoted as Vercel production deployment `dpl_GSKbwKobVZvswo5Xg9oJu5LNYghY` on `https://bitchwyat.vercel.app`. The connector reported `READY` / `PROMOTED` with the production alias assigned.

Live checks on the production alias confirmed the BitchAt login shell, `release.json` exactly `{"name":"BitchAt","version":"2.29.0","release":"2026-11-24"}`, the standalone `#0d1018` web manifest, and the generated service worker retaining `kind==="call"`, `kind==="missed_call"` and `bitchat-open-call` handling. The connected Supabase project reported all of db, rest, realtime, auth and storage healthy. Remote checks confirmed `live_arcade_mode_check` includes `grid`, `shared_activity_kind_check` includes `arcade3d`, the 3D match table has member-only SELECT and no client write grants, and the three 3D RPCs are SECURITY DEFINER with `search_path=''`.

A later docs-only commit may be pushed without changing the static output; the verified deployment above is the live app build. Physical-device checks and the boundaries in the previous section still apply.
