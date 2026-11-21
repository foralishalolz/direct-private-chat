"use client";

import { Camera, Film, ImagePlus, Sticker, X } from "lucide-react";
import { motionlessStickers } from "@/lib/stickers";
import { Sheet } from "@/components/ui/Sheet";

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onPickImages: () => void;
  onPickVideo: () => void;
  onPickCamera: () => void;
  onPickSticker: (emoji: string) => void;
}

/** Attachment tray: photos, videos, camera and a sticker board. */
export function MediaPicker({
  open,
  onClose,
  onPickImages,
  onPickVideo,
  onPickCamera,
  onPickSticker,
}: MediaPickerProps) {
  const actions = [
    { label: "Photo", icon: ImagePlus, onClick: onPickImages, tint: "from-[#f472b6] to-[#a855f7]" },
    { label: "Video", icon: Film, onClick: onPickVideo, tint: "from-[#6366f1] to-[#22d3ee]" },
    { label: "Camera", icon: Camera, onClick: onPickCamera, tint: "from-[#fb7185] to-[#f59e0b]" },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Send something" description="Photos, videos and stickers">
      <div className="grid grid-cols-3 gap-3">
        {actions.map(({ label, icon: Icon, onClick, tint }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              onClick();
              onClose();
            }}
            className="press flex flex-col items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-4"
          >
            <span
              className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${tint} text-white`}
            >
              <Icon className="size-5" strokeWidth={2} />
            </span>
            <span className="text-[12.5px] font-semibold text-[var(--text-soft)]">
              {label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
          <Sticker className="size-3.5" strokeWidth={2.4} />
          Stickers
        </p>
        <div className="grid grid-cols-6 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2">
          {motionlessStickers.map((sticker) => (
            <button
              key={sticker}
              type="button"
              onClick={() => {
                onPickSticker(sticker);
                onClose();
              }}
              className="press grid aspect-square place-items-center rounded-xl text-[24px] hover:bg-[var(--panel-2)]"
            >
              {sticker}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 px-1 text-[11.5px] text-[var(--text-faint)]">
        <X className="size-3" strokeWidth={2.5} />
        Photos are compressed automatically so they send fast on slow connections.
      </p>
    </Sheet>
  );
}
