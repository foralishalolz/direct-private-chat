"use client";

import { Bell, BellOff, BellRing, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import {
  currentPermission,
  isSubscribed,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { isIos, isStandalone } from "@/lib/utils";

/** Header bell: shows the current push status and opens the notification sheet. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );
  const [permission, setPermission] = useState(() => currentPermission());

  useEffect(() => {
    void isSubscribed().then(setSubscribed);
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    const result = await subscribeToPush();
    setBusy(false);
    setPermission(currentPermission());

    if (result.ok) {
      setSubscribed(true);
      setMessage({ tone: "ok", text: "Notifications are on for this device." });
    } else {
      setMessage({ tone: "bad", text: result.reason });
    }
  }

  async function disable() {
    setBusy(true);
    await unsubscribeFromPush();
    setSubscribed(false);
    setBusy(false);
    setMessage({ tone: "ok", text: "Notifications are off for this device." });
  }

  const blocked = permission === "denied";
  const needsIosInstall = isIos() && !isStandalone() && !pushSupported();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        className={`press relative grid size-9 place-items-center rounded-full hover:bg-[var(--panel-2)] ${
          subscribed ? "text-[var(--accent)]" : "text-[var(--text-soft)]"
        }`}
      >
        {subscribed ? (
          <BellRing className="size-[19px]" strokeWidth={1.9} />
        ) : (
          <Bell className="size-[19px]" strokeWidth={1.9} />
        )}
        {!subscribed && (
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--warning)]" />
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        description="Get pinged when your person misses you — even when the app is closed."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl accent-gradient text-white">
              <BellRing className="size-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[var(--text)]">
                {subscribed ? "Push is on" : "Push is off"}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--text-muted)]">
                {subscribed
                  ? "You'll be notified for new messages, plans and games."
                  : "Turn it on so a message never slips by unnoticed."}
              </p>
            </div>
          </div>

          {needsIosInstall && (
            <div className="rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-3.5">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--warning)]">
                <Smartphone className="size-4" strokeWidth={2} />
                Add to Home Screen first
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--warning)]/85">
                On iPhone, tap the Share button in Safari → “Add to Home Screen”.
                Then open BitchAt from your Home Screen and enable notifications
                here.
              </p>
            </div>
          )}

          {blocked && (
            <div className="rounded-2xl border border-[var(--danger)]/25 bg-[var(--danger)]/10 p-3.5 text-[12.5px] leading-relaxed text-[var(--danger)]">
              Notifications are blocked for this site. Open your browser&apos;s
              site settings and allow notifications, then try again.
            </div>
          )}

          {message && (
            <p
              className={`rounded-xl px-3 py-2 text-[12.5px] font-medium ${
                message.tone === "ok"
                  ? "bg-[var(--success)]/12 text-[var(--success)]"
                  : "bg-[var(--danger)]/12 text-[var(--danger)]"
              }`}
            >
              {message.text}
            </p>
          )}

          {subscribed ? (
            <Button
              variant="secondary"
              fullWidth
              loading={busy}
              onClick={() => void disable()}
              icon={<BellOff className="size-4" />}
            >
              Turn off notifications
            </Button>
          ) : (
            <Button
              fullWidth
              loading={busy}
              onClick={() => void enable()}
              icon={<Bell className="size-4" />}
              disabled={blocked || needsIosInstall}
            >
              Enable notifications
            </Button>
          )}

          <p className="px-1 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            BitchAt nudges you once per new message, never for your own. You can
            mute a chat individually from its settings.
          </p>
        </div>
      </Sheet>
    </>
  );
}
