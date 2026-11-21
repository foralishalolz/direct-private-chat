import type { SupabaseClient } from "@supabase/supabase-js";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await registerServiceWorker();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Subscribe to push notifications and persist the subscription row for the
 * current user. Returns true when the subscription is active.
 */
export async function subscribeToPush(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await registerServiceWorker();
  if (!registration) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;

    if (!p256dh || !auth || !subscription.endpoint) return false;

    await client.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);

    const { error } = await client.from("push_subscriptions").insert({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
    });

    if (error) {
      console.error("[push] failed to persist subscription", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[push] subscribe failed", error);
    return false;
  }
}

export async function unsubscribeFromPush(
  client: SupabaseClient,
): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await registerServiceWorker();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await subscription.unsubscribe();
    await client.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  } catch (error) {
    console.error("[push] unsubscribe failed", error);
  }
}
