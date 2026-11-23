export type PushState = { userId: string; enabled: boolean };

function openState(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bitchat-push-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("state");
      request.result.createObjectStore("seen", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Notification preferences could not be saved."));
    request.onblocked = () => reject(new Error("Close another BitchAt tab and retry."));
  });
}
export async function readPushState(): Promise<PushState | null> {
  const db = await openState();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state"), request = tx.objectStore("state").get("owner");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function writePushState(value: PushState | null): Promise<void> {
  const db = await openState();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite"), store = tx.objectStore("state");
      if (value) store.put(value, "owner"); else store.delete("owner");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error("Notification preferences could not be saved."));
      tx.onabort = () => reject(new Error("Notification preferences could not be saved."));
    });
  } finally { db.close(); }
}
