/**
 * Saved messages. Kept in IndexedDB for the signed-in account only: nothing is
 * uploaded, so there is no new table to leak and it survives offline.
 */
export type SavedMessage = {
  id: string;
  user_id: string;
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  author_id: string;
  author_name: string;
  content: string;
  media_kind: "image" | "audio" | "video" | null;
  created_at: string;
  saved_at: number;
};

const LIMIT = 300;
const DB = "bitchat-saved-v1";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("saved", { keyPath: "id" });
      store.createIndex("user", "user_id");
    };
    request.onerror = () => reject(new Error("Saved messages are unavailable."));
    request.onblocked = () => reject(new Error("Close other BitchAt tabs and try again."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listSaved(userId: string): Promise<SavedMessage[]> {
  if (!userId) return [];
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("saved", "readonly");
    const request = tx.objectStore("saved").index("user").getAll(userId);
    tx.oncomplete = () => { db.close(); resolve((request.result as SavedMessage[]).sort((a, b) => b.saved_at - a.saved_at)); };
    tx.onabort = () => { db.close(); reject(new Error("Could not load saved messages.")); };
  });
}

export async function saveMessage(userId: string, message: Omit<SavedMessage, "user_id" | "id" | "saved_at">): Promise<void> {
  if (!userId) throw new Error("Sign in again.");
  const row: SavedMessage = { ...message, user_id: userId, id: userId + ":" + message.message_id, saved_at: Date.now() };
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("saved", "readwrite"), store = tx.objectStore("saved");
    store.put(row);
    const all = store.index("user").getAll(userId);
    // Keep the newest few hundred so local storage cannot grow without bound.
    all.onsuccess = () => {
      const rows = (all.result as SavedMessage[]).sort((a, b) => b.saved_at - a.saved_at);
      rows.slice(LIMIT).forEach(extra => store.delete(extra.id));
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error("Could not save that message.")); };
  });
}

export async function removeSaved(userId: string, id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("saved", "readwrite"), store = tx.objectStore("saved");
    const row = store.get(id);
    row.onsuccess = () => { if ((row.result as SavedMessage | undefined)?.user_id === userId) store.delete(id); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error("Could not remove that.")); };
  });
}

export const isSaved = (rows: SavedMessage[], messageId: string) => rows.some(row => row.message_id === messageId);

export function authorName(display?: string | null, username?: string | null) {
  return display || username || "Someone";
}
