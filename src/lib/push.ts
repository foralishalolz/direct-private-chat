"use client";

import { supabase } from "@/lib/supabase";

/** Convert the base64url VAPID key used by the browser API. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export type PushPermissionState =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function currentPermission(): PushPermissionState {
  if (!pushSupported()) return "unsupported";
  return Notification.permission as PushPermissionState;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}

/**
 * Ask for notification permission, register the device with the push service
 * and persist the subscription against the signed-in user.
 */
export async function subscribeToPush(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!pushSupported()) {
    return {
      ok: false,
      reason:
        "This browser can't receive push notifications. On iPhone, add the app to your Home Screen first.",
    };
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return {
      ok: false,
      reason: "Push isn't configured on this deployment yet.",
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      reason:
        permission === "denied"
          ? "Notifications are blocked. Enable them in your browser settings."
          : "Notification permission was not granted.",
    };
  }

  const registration = await getRegistration();
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });
  }

  const { data: sessionData } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  };
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, reason: "You need to be signed in." };

  const payload = subscription.toJSON();

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: payload.endpoint,
      keys: payload.keys,
      userAgent: navigator.userAgent,
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: "Could not save this device for notifications." };
  }

  localStorage.setItem("bitchat-push-enabled", "1");
  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;

  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      const { data: sessionData } = (await supabase?.auth.getSession()) ?? {
        data: { session: null },
      };
      const token = sessionData?.session?.access_token;

      if (token) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint }),
        });
      }
    }
  } catch {
    /* ignore — the UI flips state regardless */
  }

  localStorage.removeItem("bitchat-push-enabled");
}

/** Fire a local notification immediately (used for the "miss you" nudge). */
export async function showLocalNotification(
  title: string,
  options: NotificationOptions = {},
): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const registration = await getRegistration();
    await registration.showNotification(title, {
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      ...options,
    });
  } catch {
    /* ignore */
  }
}
