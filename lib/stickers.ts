export type SavedSticker = { id: string; user_id: string; blob: Blob; bytes: number; created_at: number };
export const STICKER_LIMIT = 60;
export const STICKER_BYTES = 512 * 1024;
const ACCOUNT_BYTES = 16 * 1024 * 1024;
const DEVICE_BYTES = 32 * 1024 * 1024;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bitchat-stickers", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("stickers", { keyPath: "id" });
      store.createIndex("user", "user_id");
    };
    request.onerror = () => reject(new Error("Sticker storage is unavailable."));
    request.onblocked = () => reject(new Error("Close other BitchAt tabs and try again."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listStickers(userId: string): Promise<SavedSticker[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stickers", "readonly");
    const request = tx.objectStore("stickers").index("user").getAll(userId);
    tx.oncomplete = () => { db.close(); resolve((request.result as SavedSticker[]).sort((a, b) => b.created_at - a.created_at)); };
    tx.onabort = () => { db.close(); reject(new Error("Could not load stickers.")); };
  });
}

export async function saveSticker(userId: string, blob: Blob): Promise<string> {
  if (!userId || !/^image\/(webp|png|jpeg)$/.test(blob.type) || !blob.size || blob.size > STICKER_BYTES) throw new Error("Choose a sticker under 512 KB.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, "0")).join("");
  const id = userId + ":" + hash;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stickers", "readwrite"), store = tx.objectStore("stickers");
    const request = store.getAll();
    request.onsuccess = () => {
      const rows: SavedSticker[] = request.result.filter((row: SavedSticker) => row.id !== id);
      // IndexedDB serializes this transaction across tabs. A monotonic stamp
      // keeps FIFO eviction correct when saves share a millisecond or the clock changes.
      const created_at = rows.reduce((latest, row) => Math.max(latest, row.created_at + 1), Date.now());
      const next: SavedSticker = { id, user_id: userId, blob, bytes: blob.size, created_at };
      rows.push(next);
      rows.sort((a, b) => a.created_at - b.created_at);
      let own = rows.filter(row => row.user_id === userId);
      let ownBytes = own.reduce((sum, row) => sum + row.bytes, 0);
      while (own.length > STICKER_LIMIT || ownBytes > ACCOUNT_BYTES) {
        const removed = own.shift()!; ownBytes -= removed.bytes;
        store.delete(removed.id); rows.splice(rows.findIndex(row => row.id === removed.id), 1);
      }
      let total = rows.reduce((sum, row) => sum + row.bytes, 0);
      while (total > DEVICE_BYTES && rows.length > 1) { const removed = rows.shift()!; total -= removed.bytes; store.delete(removed.id); }
      store.put(next);
    };
    tx.oncomplete = () => { db.close(); resolve(id); };
    tx.onabort = () => { db.close(); reject(new Error("Device storage is full or unavailable.")); };
  });
}

export async function deleteSticker(userId: string, id?: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stickers", "readwrite"), store = tx.objectStore("stickers");
    const request = store.index("user").getAllKeys(userId);
    request.onsuccess = () => { for (const key of request.result) if (!id || key === id) store.delete(key); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error("Could not remove the sticker.")); };
  });
}
