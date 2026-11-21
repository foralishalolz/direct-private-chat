"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Renders flush to the bottom without internal padding. */
  bare?: boolean;
}

/** Native-feeling bottom sheet with backdrop, scroll lock and Escape support. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  bare = false,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-sheet-up relative w-full max-w-lg overflow-hidden rounded-t-[26px] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-pop)] sm:rounded-[26px] ${
          bare ? "" : "pb-safe"
        }`}
        style={{ maxHeight: "92dvh" }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" />

        {(title || description) && !bare && (
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
            <div className="min-w-0">
              {title && (
                <h2 className="text-[17px] font-semibold tracking-tight text-[var(--text)]">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-muted)]">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press grid size-8 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        )}

        <div
          className={`thin-scrollbar overflow-y-auto ${bare ? "" : "px-5 pb-4 pt-3"}`}
          style={{ maxHeight: "calc(92dvh - 4rem)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
