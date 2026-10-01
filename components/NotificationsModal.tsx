"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { disableNotifications, enableNotifications, notificationsEnabled, NOTIFICATION_EVENT } from "@/lib/notifications";
import { errorText } from "@/lib/types";
import { ErrorNote, Modal, Spinner } from "./UI";

export default function NotificationsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const update = () => setEnabled(notificationsEnabled(userId) && "Notification" in window && Notification.permission === "granted"); update(); window.addEventListener(NOTIFICATION_EVENT, update); window.addEventListener("storage", update); return () => { window.removeEventListener(NOTIFICATION_EVENT, update); window.removeEventListener("storage", update); }; }, [userId]);
  async function toggle() { if (busy) return; setBusy(true); setError(""); try { if (enabled) { await disableNotifications(userId); } else await enableNotifications(userId); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  return <Modal title="Notifications" onClose={onClose}><div className="panel-pad notification-panel"><span className={"notification-glyph "+(enabled?"enabled":"")} aria-hidden="true"><Bell size={33}/></span><button className="menu-item" role="switch" aria-label="Message alerts" aria-checked={enabled} disabled={busy} onClick={() => void toggle()}>{busy ? <Spinner/> : enabled ? <Bell size={21}/> : <BellOff size={21}/>}<span>Message alerts</span><span className={"switch " + (enabled ? "on" : "")} aria-hidden="true"/></button><ErrorNote text={error}/></div></Modal>;
}
