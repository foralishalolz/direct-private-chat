type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
export function dataSaver(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof document !== "undefined" && document.documentElement.dataset.dataSaver === "true") return true;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  return !!connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType ?? "");
}
export function watchDeviceMode(userId: string) {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const apply = () => {
    let manual = false;
    try { manual = localStorage.getItem("bitchat-data-saver:" + userId) === "true"; } catch {}
    const saving = manual || !!connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType ?? "");
    document.documentElement.dataset.dataSaver = String(saving);
  };
  apply(); connection?.addEventListener("change", apply);
  window.addEventListener("storage", apply); window.addEventListener("bitchat-device-change", apply);
  return () => { connection?.removeEventListener("change", apply); window.removeEventListener("storage", apply); window.removeEventListener("bitchat-device-change", apply); delete document.documentElement.dataset.dataSaver; };
}
export function setDataSaver(userId: string, enabled: boolean) {
  localStorage.setItem("bitchat-data-saver:" + userId, String(enabled));
  window.dispatchEvent(new Event("bitchat-device-change"));
}
