/**
 * Relay configuration.
 *
 * Calls connect peer to peer first. When both partners are on mobile data a
 * direct path often does not exist, and only a TURN relay can carry the media.
 * The automatic relay uses short-lived server-issued credentials. An optional
 * custom override stays on this device in localStorage.
 */
export type TurnConfig = { url: string; username: string; credential: string };

const KEY = "bitchat-turn";

const clean = (value: string) => value.trim().replace(/^["']|["']$/g, "");

export function readTurn(): TurnConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TurnConfig>;
    const url = clean(String(parsed.url ?? ""));
    if (!/^turns?:/.test(url)) return null;
    return { url, username: String(parsed.username ?? ""), credential: String(parsed.credential ?? "") };
  } catch {
    return null;
  }
}

/** Validate and trim a relay entry without touching storage. */
export function normalizeTurn(config: TurnConfig): TurnConfig {
  const url = clean(config.url);
  if (!/^turns?:/.test(url)) throw new Error("A relay address starts with turn: or turns:.");
  const host = url.slice(url.indexOf(":") + 1);
  if (!/^[a-z0-9.\-]+(:\d{1,5})?(\?transport=(udp|tcp))?$/i.test(host)) throw new Error("That relay address does not look right.");
  const port = /:(\d{1,5})/.exec(host)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error("That relay port is out of range.");
  return { url, username: clean(config.username).slice(0, 200), credential: clean(config.credential).slice(0, 200) };
}

export function writeTurn(config: TurnConfig | null): TurnConfig | null {
  try {
    if (!config) { localStorage.removeItem(KEY); return null; }
    const next = normalizeTurn(config);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch (cause) {
    if (cause instanceof DOMException) throw new Error("This browser blocks local storage, so the relay cannot be saved.");
    throw cause;
  }
}

/** The public STUN servers BitchAt always ships with. */
export const BASE_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

export function relay(): RTCIceServer[] {
  const config = readTurn();
  return config ? [{ urls: config.url, username: config.username || undefined, credential: config.credential || undefined }] : [];
}

/**
 * Ask the relay for an allocation without contacting anyone else. A working
 * relay produces a `relay` candidate within a few seconds; silence means a
 * wrong address, bad credentials, or a blocked port.
 */
export async function testRelay(config: TurnConfig, timeout = 8000): Promise<{ ok: boolean; detail: string }> {
  if (typeof RTCPeerConnection === "undefined") return { ok: false, detail: "Calling is not available in this browser." };
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: config.url, username: config.username || undefined, credential: config.credential || undefined }],
    iceTransportPolicy: "relay",
  });
  try {
    pc.createDataChannel("probe");
    const done = new Promise<{ ok: boolean; detail: string }>(resolve => {
      const finish = (result: { ok: boolean; detail: string }) => resolve(result);
      const timer = setTimeout(() => finish({ ok: false, detail: "No answer from the relay. Check the address, the port, and that UDP/TCP 3478 or 5349 is reachable." }), timeout);
      pc.onicecandidate = event => {
        if (!event.candidate) return;
        const text = event.candidate.candidate;
        if (/ typ relay /.test(text)) { clearTimeout(timer); finish({ ok: true, detail: "Relay is reachable from this device." }); }
      };
      pc.onicecandidateerror = event => {
        // 401 means the relay answered but rejected the credentials — worth
        // reporting precisely, since that is the usual mistake.
        if ((event as RTCPeerConnectionIceErrorEvent).errorCode === 401) { clearTimeout(timer); finish({ ok: false, detail: "The relay rejected these credentials." }); }
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await done;
  } finally {
    try { pc.close(); } catch { /* already closed */ }
  }
}

export function describeRelay(): string {
  const config = readTurn();
  if (config) return config.username ? "Relay configured for " + config.username : "Relay configured";
  return "Automatic Cloudflare relay (optional custom relay below)";
}
