const key = (userId: string) => "bitchat-notifications:" + userId;
export const NOTIFICATION_EVENT = "bitchat-notifications-change";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function notificationsEnabled(userId: string): boolean {
  try { return localStorage.getItem(key(userId)) === "true"; } catch { return false; }
}
export function setNotifications(userId: string, enabled: boolean) {
  try { localStorage.setItem(key(userId), String(enabled)); } catch { throw new Error("Device preferences could not be saved."); }
  window.dispatchEvent(new Event(NOTIFICATION_EVENT));
}
export async function enableNotifications(userId: string): Promise<void> {
  if (!("Notification" in window) || !window.isSecureContext) throw new Error("Notifications are unavailable in this browser. On iPhone, open BitchAt from your Home Screen.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked in your browser settings." : "Notifications were not enabled.");
  setNotifications(userId, true);
}
export async function clearNotifications(userId: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  for (const item of await registration?.getNotifications() ?? []) if (item.data?.userId === userId) item.close();
}
export async function notifyMessage(userId: string, conversationId: string, messageId: string, current: () => boolean = () => true): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted" || !notificationsEnabled(userId)) return;
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (!registration?.active || !current() || !notificationsEnabled(userId) || Notification.permission !== "granted") return;
  await registration.showNotification("BitchAt", { body: "New message", icon: "/icon.svg", badge: "/icon.svg", tag: "bitchat:" + userId + ":" + conversationId, data: { userId, conversationId } });
}
