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

/** Follow the visible viewport so the iPhone keyboard cannot cover the composer. */
export function watchViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const mobile = window.matchMedia("(max-width: 760px)");
  let frame = 0;
  const clear = () => { document.documentElement.style.removeProperty("--app-height"); document.documentElement.style.removeProperty("--app-offset"); delete document.documentElement.dataset.keyboardOpen; };
  const apply = () => {
    frame = 0;
    if (!mobile.matches || Math.abs(viewport.scale - 1) > .05) { clear(); return; }
    document.documentElement.style.setProperty("--app-height", Math.round(viewport.height) + "px");
    document.documentElement.style.setProperty("--app-offset", Math.round(viewport.offsetTop) + "px");
    document.documentElement.dataset.keyboardOpen = String(window.innerHeight - viewport.height > 120);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  apply(); viewport.addEventListener("resize", schedule); viewport.addEventListener("scroll", schedule); window.addEventListener("resize", schedule);
  return () => { cancelAnimationFrame(frame); viewport.removeEventListener("resize", schedule); viewport.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); clear(); };
}
