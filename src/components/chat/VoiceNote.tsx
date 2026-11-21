"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/utils";

/** Minimal custom audio player — the native one looks out of place in bubbles. */
export function VoiceNote({
  url,
  duration,
  tone = "neutral",
}: {
  url: string;
  duration?: number | null;
  tone?: "neutral" | "onAccent";
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setTotal(Math.round(audio.duration));
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play().catch(() => undefined);
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  const progress = total > 0 ? Math.min(1, current / total) : 0;
  const barTone = tone === "onAccent" ? "bg-white/35" : "bg-white/10";
  const fillTone = tone === "onAccent" ? "bg-white" : "bg-[var(--accent)]";
  const textTone = tone === "onAccent" ? "text-white" : "text-[var(--text)]";

  return (
    <div className="flex w-[220px] items-center gap-2.5 px-3 py-2.5">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "Pause" : "Play"}
        className={`grid size-9 shrink-0 place-items-center rounded-full ${
          tone === "onAccent" ? "bg-white/25 text-white" : "bg-[var(--accent)]/20 text-[var(--accent)]"
        }`}
      >
        {playing ? (
          <Pause className="size-4 fill-current" strokeWidth={0} />
        ) : (
          <Play className="ml-0.5 size-4 fill-current" strokeWidth={0} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`h-1.5 overflow-hidden rounded-full ${barTone}`}>
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${fillTone}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className={`mt-1 flex justify-between text-[10.5px] tabular-nums ${textTone} opacity-70`}>
          <span>{formatDuration(current)}</span>
          <span>{formatDuration(total)}</span>
        </div>
      </div>
    </div>
  );
}
