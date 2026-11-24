/** Pure rules for the couple-themed 3D arcade. The database independently
 * validates scoring; this module keeps client movement, collection and
 * Realtime payloads small, deterministic and testable without WebGL. */

export type Couple3DMode = "orbit" | "garden" | "rally";
export type Couple3DSide = "a" | "b";
export type Couple3DHeart = {
  id: string;
  x: number;
  y: number;
  z: number;
  collected_by: Couple3DSide | null;
};
export type Couple3DMatch = {
  conversation_id: string;
  round_id: string;
  mode: Couple3DMode;
  items: Couple3DHeart[];
  score_a: number;
  score_b: number;
  winner: string | null;
  finished: boolean;
  started_by: string;
  updated_at: string;
};
export type AvatarPosition = { x: number; y: number; z: number; yaw: number; t?: number };
export type Couple3DBroadcast = {
  type: "move" | "sync" | "collect";
  userId: string;
  roundId: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  item?: string;
  t?: number;
};
export type MovementKeys = ReadonlySet<string>;

export const COUPLE_3D_MODES: readonly {
  id: Couple3DMode;
  name: string;
  icon: string;
  hint: string;
  blurb: string;
  rule: string;
  inspiration: string;
}[] = [
  {
    id: "orbit",
    name: "Promise Orbits",
    icon: "💫",
    hint: "Float through a tiny planet",
    blurb: "Chase six promise hearts around a moonlit world. Most hearts when they are gone wins.",
    rule: "Free collection · highest score wins",
    inspiration: "Tiny Planet exploration",
  },
  {
    id: "garden",
    name: "Moonlit Garden",
    icon: "🌷",
    hint: "Bloom hearts together",
    blurb: "Find a glowing bloom and stand beside it together. Every flower opens as a shared win.",
    rule: "Both players nearby · no loser",
    inspiration: "Low-poly social sandbox",
  },
  {
    id: "rally",
    name: "Starlight Rally",
    icon: "✨",
    hint: "Follow the constellation",
    blurb: "Only the next star in the constellation is live. Reach four hearts first to win.",
    rule: "Collect in order · first to four",
    inspiration: "Open-world rally",
  },
];

export const WORLD = { x: 11.5, z: 11.5, minY: 0.8, maxY: 5.8, radius: 1.65, peerStaleMs: 6000 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM = /^[a-z0-9-]{1,24}$/;

/** Mirrors `private.couple3d_items()` in the additive SQL migration. */
const LAYOUTS: Record<Couple3DMode, readonly Couple3DHeart[]> = {
  orbit: [
    { id: "h1", x: -7, y: 2, z: -5, collected_by: null },
    { id: "h2", x: -2, y: 4, z: -8, collected_by: null },
    { id: "h3", x: 4, y: 3, z: -7, collected_by: null },
    { id: "h4", x: 8, y: 2, z: -1, collected_by: null },
    { id: "h5", x: 2, y: 5, z: 6, collected_by: null },
    { id: "h6", x: -6, y: 3, z: 7, collected_by: null },
  ],
  garden: [
    { id: "h1", x: -8, y: 1, z: -6, collected_by: null },
    { id: "h2", x: -3, y: 2, z: -2, collected_by: null },
    { id: "h3", x: 3, y: 1, z: -7, collected_by: null },
    { id: "h4", x: 8, y: 2, z: 2, collected_by: null },
    { id: "h5", x: 1, y: 3, z: 7, collected_by: null },
    { id: "h6", x: -7, y: 2, z: 5, collected_by: null },
  ],
  rally: [
    { id: "h1", x: -9, y: 3, z: 0, collected_by: null },
    { id: "h2", x: -4, y: 5, z: -6, collected_by: null },
    { id: "h3", x: 0, y: 2, z: -9, collected_by: null },
    { id: "h4", x: 5, y: 4, z: -5, collected_by: null },
    { id: "h5", x: 9, y: 3, z: 2, collected_by: null },
    { id: "h6", x: -2, y: 5, z: 8, collected_by: null },
  ],
};

export function heartLayout(mode: Couple3DMode): Couple3DHeart[] {
  return LAYOUTS[mode].map(heart => ({ ...heart }));
}

export function modeInfo(mode: Couple3DMode) {
  return COUPLE_3D_MODES.find(item => item.id === mode) ?? COUPLE_3D_MODES[0];
}

export function sideForUser(memberA: string | null, memberB: string | null, userId: string): Couple3DSide | null {
  if (memberA === userId) return "a";
  if (memberB === userId) return "b";
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function clampPosition(position: AvatarPosition): AvatarPosition {
  return {
    x: clamp(position.x, -WORLD.x, WORLD.x),
    y: clamp(position.y, WORLD.minY, WORLD.maxY),
    z: clamp(position.z, -WORLD.z, WORLD.z),
    yaw: clamp(position.yaw, -6.3, 6.3),
    t: position.t,
  };
}

function wrapYaw(yaw: number): number {
  let value = yaw % (Math.PI * 2);
  if (value > Math.PI) value -= Math.PI * 2;
  if (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/** Forward/turn/lift controls work with a keyboard or the on-screen pad. */
export function stepAvatar(position: AvatarPosition, keys: MovementKeys, deltaSeconds: number): AvatarPosition {
  const dt = clamp(deltaSeconds, 0, 0.05);
  const forward = (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0);
  const turn = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  const lift = (keys.has("float") ? 1 : 0) - (keys.has("sink") ? 1 : 0);
  const yaw = wrapYaw(position.yaw + turn * 2.1 * dt);
  const speed = 5.2;
  return clampPosition({
    x: position.x - Math.sin(yaw) * forward * speed * dt,
    y: position.y + lift * 2.8 * dt,
    z: position.z - Math.cos(yaw) * forward * speed * dt,
    yaw,
    t: position.t,
  });
}

export function distance(a: AvatarPosition, b: Pick<AvatarPosition, "x" | "y" | "z">): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * 0.8, a.z - b.z);
}

export function nextRallyHeart(hearts: readonly Couple3DHeart[]): Couple3DHeart | null {
  return hearts.find(heart => !heart.collected_by) ?? null;
}

/** Garden blooms need both people; rally only exposes the next star. */
export function eligibleHearts(mode: Couple3DMode, hearts: readonly Couple3DHeart[]): Couple3DHeart[] {
  const open = hearts.filter(heart => !heart.collected_by);
  return mode === "rally" ? open.slice(0, 1) : open;
}

export function nearestCollectible(
  mode: Couple3DMode,
  hearts: readonly Couple3DHeart[],
  mine: AvatarPosition,
  partner: AvatarPosition | null,
  now = Date.now(),
): Couple3DHeart | null {
  const peerNearby = !!partner && (!partner.t || now - partner.t < WORLD.peerStaleMs);
  for (const heart of eligibleHearts(mode, hearts)) {
    const close = distance(mine, heart) <= WORLD.radius;
    if (mode === "garden") {
      if (close && peerNearby && distance(partner as AvatarPosition, heart) <= WORLD.radius * 1.25) return heart;
    } else if (close) return heart;
  }
  return null;
}

export function canCollect(
  mode: Couple3DMode,
  hearts: readonly Couple3DHeart[],
  itemId: string,
  mine: AvatarPosition,
  partner: AvatarPosition | null,
  now = Date.now(),
): boolean {
  return nearestCollectible(mode, hearts, mine, partner, now)?.id === itemId;
}

export function broadcastPayload(
  type: Couple3DBroadcast["type"],
  userId: string,
  roundId: string,
  position?: AvatarPosition,
  item?: string,
): Couple3DBroadcast {
  const payload: Couple3DBroadcast = { type, userId, roundId, t: Date.now() };
  if (position && type !== "collect") Object.assign(payload, {
    x: Number(position.x.toFixed(3)),
    y: Number(position.y.toFixed(3)),
    z: Number(position.z.toFixed(3)),
    yaw: Number(position.yaw.toFixed(3)),
  });
  if (type === "collect" && item) payload.item = item;
  return payload;
}

/** Ignore malformed / stale / oversized Realtime messages before they reach the scene. */
export function validateBroadcast(value: unknown, roundId: string): Couple3DBroadcast | null {
  if (!value || typeof value !== "object" || JSON.stringify(value).length > 512) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.userId !== "string" || !UUID.test(v.userId) || v.roundId !== roundId || !UUID.test(roundId)) return null;
  if (v.type !== "move" && v.type !== "sync" && v.type !== "collect") return null;
  if (typeof v.t !== "number" || !Number.isFinite(v.t) || Math.abs(Date.now() - v.t) > 30000) return null;
  if (v.type === "collect") {
    return typeof v.item === "string" && ITEM.test(v.item)
      ? { type: "collect", userId: v.userId, roundId, item: v.item, t: v.t }
      : null;
  }
  const numbers = [v.x, v.y, v.z, v.yaw];
  if (numbers.some(n => typeof n !== "number" || !Number.isFinite(n))) return null;
  const position = clampPosition({ x: v.x as number, y: v.y as number, z: v.z as number, yaw: v.yaw as number, t: v.t });
  return { type: v.type, userId: v.userId, roundId, ...position };
}

export function scoreLine(match: Couple3DMatch, side: Couple3DSide, partnerName: string): string {
  const mine = side === "a" ? match.score_a : match.score_b;
  const theirs = side === "a" ? match.score_b : match.score_a;
  return match.mode === "garden" ? `🌷 ${match.score_a + match.score_b}/6 blooms together` : `You ${mine} · ${partnerName} ${theirs}`;
}

export function resultText(match: Couple3DMatch, viewerId: string, partnerName: string): string {
  if (!match.finished) return "";
  if (match.mode === "garden") return "🌷 Every flower bloomed together. No winner, just us.";
  if (match.winner === viewerId) return "✨ You won this round!";
  if (match.winner) return `✨ ${partnerName} won this round!`;
  if (match.score_a === match.score_b) return "🤍 A tie. One more round?";
  return "Round ended.";
}

/** Small deterministic PRNG so procedural stars are stable between players. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
