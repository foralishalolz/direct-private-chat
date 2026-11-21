"use client";

import { Download, X } from "lucide-react";
import { useEffect } from "react";

/** Full-screen photo viewer with pinch/scroll zoom and save support. */
export function Lightbox({
  open,
  url,
  alt,
  onClose,
}: {
  open: boolean;
  url: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !url) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95 animate-fade-in">
      <div className="safe-top flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="press grid size-10 place-items-center rounded-full bg-white/10 text-white"
        >
          <X className="size-5" strokeWidth={2.2} />
        </button>
        <a
          href={url}
          download
          target="_blank"
          rel="noreferrer"
          aria-label="Save photo"
          className="press grid size-10 place-items-center rounded-full bg-white/10 text-white"
        >
          <Download className="size-5" strokeWidth={2} />
        </a>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className="mx-auto max-h-full max-w-full rounded-lg object-contain animate-chat-pop"
        />
      </div>

      {alt && (
        <p className="px-6 pb-[max(1.5rem,var(--safe-bottom))] text-center text-[13px] text-white/70">
          {alt}
        </p>
      )}
    </div>
  );
}
