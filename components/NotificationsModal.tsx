"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { clearNotifications, enableNotifications, notificationsEnabled, NOTIFICATION_EVENT, setNotifications } from "@/lib/notifications";
import { errorText } from "@/lib/types";
import { ErrorNote, Modal, Spinner } from "./UI";

export default function NotificationsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const update = () => setEnabled(notificationsEnabled(userId) && "Notification" in window && Notification.permission === "granted"); update(); window.addEventListener(NOTIFICATION_EVENT, update); window.addEventListener("storage", update); return () => { window.removeEventListener(NOTIFICATION_EVENT, update); window.removeEventListener("storage", update); }; }, [userId]);
  async function toggle() { if (busy) return; setBusy(true); setError(""); try { if (enabled) { setNotifications(userId, false); await clearNotifications(userId); } else await enableNotifications(userId); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  return <Modal title="Notifications" onClose={onClose}><div className="panel-pad"><button className="menu-item" disabled={busy} onClick={() => void toggle()}>{busy ? <Spinner/> : enabled ? <Bell size={21}/> : <BellOff size={21}/>}<span>Message alerts</span><span className={"switch " + (enabled ? "on" : "")} role="switch" aria-label="Message alerts" aria-checked={enabled}/></button><ErrorNote text={error}/></div></Modal>;
}
