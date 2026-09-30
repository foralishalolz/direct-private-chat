import { db, rpc } from "./supabase";
import { readPushState, writePushState } from "./pushState";

const key = (userId: string) => "bitchat-notifications:" + userId;
const OWNER = "bitchat-push-owner";
export const NOTIFICATION_EVENT = "bitchat-notifications-change";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let revision = 0, chain: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const result = chain.then(work, work); chain = result.catch(() => {}); return result;
};
export function notificationsEnabled(userId: string): boolean {
  try { return localStorage.getItem(key(userId)) === "true" && localStorage.getItem(OWNER) === userId; } catch { return false; }
}
export function setNotifications(userId: string, enabled: boolean) {
  try { localStorage.setItem(key(userId), String(enabled)); } catch { throw new Error("Device preferences could not be saved."); }
  window.dispatchEvent(new Event(NOTIFICATION_EVENT));
}
async function current(userId: string, operation: number) {
  const { data: { session } } = await db().auth.getSession();
  if (revision !== operation || session?.user.id !== userId) throw new Error("Notification request cancelled.");
}
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{87}$/.test(key)) throw new Error("Notification service is unavailable. Try again.");
  const value = atob(key.replaceAll("-", "+").replaceAll("_", "/") + "=");
  const bytes = Uint8Array.from(value, char => char.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Notification service is unavailable. Try again.");
  return bytes;
}
async function registration() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Notification service is starting. Try again.")), 10000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function removeServerSubscription(endpoint: string) {
  const { error } = await db().rpc("unregister_push_subscription", { p_endpoint: endpoint }).abortSignal(AbortSignal.timeout(5000));
  if (error) throw error;
}
export async function enableNotifications(userId: string): Promise<void> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext)
    throw new Error("Notifications are unavailable in this browser. On iPhone, open BitchAt from your Home Screen.");
  // Request permission within the tap, before awaiting network or storage.
  const operation = ++revision, permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked in your browser settings." : "Notifications were not enabled.");
  await serial(async () => {
    await current(userId, operation);
    const reg = await registration(), publicKey = await rpc<string | null>("push_public_key");
    if (!publicKey) throw new Error("Notification service is unavailable. Try again.");
    const bytes = keyBytes(publicKey);
    let subscription = await reg.pushManager.getSubscription(), created = false;
    const owner = await readPushState();
    if (subscription) {
      const existingKey = subscription.options.applicationServerKey;
      const matches = existingKey && Array.from(new Uint8Array(existingKey)).every((value, i) => value === bytes[i]) && existingKey.byteLength === bytes.length;
      if (owner?.userId !== userId || !matches) {
        if (owner?.userId === userId) await removeServerSubscription(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe(); subscription = null;
      }
    }
    await current(userId, operation);
    try {
      if (!subscription) { subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }); created = true; }
      await current(userId, operation);
      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys?.auth) throw new Error("Notification subscription unavailable.");
      await rpc("register_push_subscription", { p_endpoint: subscription.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
      await current(userId, operation);
      await writePushState({ userId, enabled: true });
      await current(userId, operation);
      localStorage.setItem(OWNER, userId); setNotifications(userId, true);
    } catch (error) {
      const { data: { session } } = await db().auth.getSession();
      if (subscription && session?.user.id === userId) await removeServerSubscription(subscription.endpoint).catch(() => {});
      if (created) await subscription?.unsubscribe().catch(() => {});
      if (revision === operation) { await writePushState(null).catch(() => {}); setNotifications(userId, false); }
      throw error;
    }
  });
}
export async function clearNotifications(userId: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  for (const item of await reg?.getNotifications() ?? []) if (item.data?.userId === userId) item.close();
}
export async function disableNotifications(userId: string): Promise<void> {
  ++revision;
  try { setNotifications(userId, false); } catch {}
  await serial(async () => {
    const owner = await readPushState().catch(() => null);
    if (owner?.userId === userId) {
      await writePushState(null);
      if (localStorage.getItem(OWNER) === userId) localStorage.removeItem(OWNER);
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration(), subscription = await reg?.pushManager?.getSubscription();
        if (subscription) {
          await subscription.unsubscribe().catch(() => {});
          const { data: { session } } = await db().auth.getSession();
          if (session?.user.id === userId) await removeServerSubscription(subscription.endpoint).catch(() => {});
        }
      }
    }
    await clearNotifications(userId);
  });
}
/** Restore an existing opt-in. Never ask for permission or silently subscribe. */
export async function restoreNotifications(userId: string): Promise<void> {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
  const operation = revision;
  await serial(async () => {
    await current(userId, operation);
    const owner = await readPushState(), reg = await navigator.serviceWorker.getRegistration();
    await current(userId, operation);
    if (owner && owner.userId !== userId) {
      await writePushState(null); await reg?.pushManager?.getSubscription().then(sub => sub?.unsubscribe());
      localStorage.removeItem(OWNER); setNotifications(owner.userId, false); return;
    }
    if (!notificationsEnabled(userId)) return;
    const subscription = await reg?.pushManager?.getSubscription();
    await current(userId, operation);
    if (!subscription || Notification.permission !== "granted") {
      await writePushState(null); localStorage.removeItem(OWNER); setNotifications(userId, false); return;
    }
    const json = subscription.toJSON();
    await current(userId, operation);
    const { error } = await db().rpc("register_push_subscription", { p_endpoint: subscription.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth }).abortSignal(AbortSignal.timeout(5000));
    if (error) throw error;
  });
}
