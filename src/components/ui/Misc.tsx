"use client";

import { Check, CheckCheck, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-end justify-between px-1">
      <h2 className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid size-14 place-items-center rounded-3xl border border-[var(--border)] bg-[var(--panel)] text-[var(--text-muted)]">
        {icon}
      </div>
      <p className="mt-4 text-[15px] font-semibold text-[var(--text)]">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-[17rem] text-[13px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`animate-spin text-[var(--text-muted)] ${className}`}
      strokeWidth={1.8}
    />
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "bg-[var(--panel-2)] text-[var(--text-muted)] border-[var(--border)]",
    accent: "bg-[var(--accent-soft)] text-[var(--accent)] border-transparent",
    success: "bg-[var(--success)]/12 text-[var(--success)] border-transparent",
    warning: "bg-[var(--warning)]/12 text-[var(--warning)] border-transparent",
    danger: "bg-[var(--danger)]/12 text-[var(--danger)] border-transparent",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function DeliveryTicks({
  status,
  read,
}: {
  status?: "sending" | "sent" | "failed";
  read?: boolean;
}) {
  if (status === "sending") {
    return (
      <LoaderCircle
        aria-label="Sending"
        className="size-3.5 animate-spin opacity-80"
        strokeWidth={2.4}
      />
    );
  }

  if (status === "failed") {
    return (
      <span
        aria-label="Failed to send"
        className="text-[10px] font-bold text-white/85"
      >
        !
      </span>
    );
  }

  if (read) {
    return (
      <CheckCheck
        aria-label="Read"
        className="size-3.5 text-[#b6f7ff] drop-shadow"
        strokeWidth={2.6}
      />
    );
  }

  return (
    <Check aria-label="Sent" className="size-3.5 opacity-80" strokeWidth={2.6} />
  );
}
