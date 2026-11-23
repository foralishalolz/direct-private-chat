"use client";

import { memo, useMemo, useRef, useState } from "react";
import { EMOJI_GROUPS, EMOJI_ROWS } from "@/lib/emoji-data";

/**
 * Nearly 4,000 emoji and skin-tone variants: one vertically scrolling sheet split into categories, with
 * a pinning tab strip. The
 * grid is memoised so typing in the composer never re-renders it.
 */

const LABELS: Record<string, { name: string; glyph: string }> = {
  "smileys-emotion": { name: "Smiles", glyph: "😊" },
  "people-body": { name: "People", glyph: "🫶" },
  "animals-nature": { name: "Nature", glyph: "🌸" },
  "food-drink": { name: "Food", glyph: "🍓" },
  "travel-places": { name: "Places", glyph: "🌙" },
  activities: { name: "Play", glyph: "🎮" },
  objects: { name: "Things", glyph: "🎁" },
  symbols: { name: "Symbols", glyph: "💕" },
  flags: { name: "Flags", glyph: "🏳️" },
};

const LOVE = ["❤️", "💋", "🥰", "😘", "💕", "💞", "💘", "💗", "💓", "🫶", "😽", "🫦", "🥹", "😻", "💌", "🌹", "🧸", "🫂", "💐", "🎀"];
const CATEGORIES = ["love", ...EMOJI_GROUPS];

type Props = { recent: string[]; onPick: (glyph: string) => void };

export default memo(function EmojiPicker({ recent, onPick }: Props) {
  const [active, setActive] = useState("love");
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const jumping = useRef(false);

  const grouped = useMemo(() => {
    const map: Record<string, string[]> = { love: LOVE, recent: recent.filter(glyph => !LOVE.includes(glyph)) };
    for (const name of EMOJI_GROUPS) map[name] = [];
    for (const [glyph, name] of EMOJI_ROWS) (map[name] ||= []).push(glyph);
    return map;
  }, [recent]);

  function jump(name: string) {
    setActive(name);
    const node = sections.current[name], box = scroller.current;
    if (!node || !box) return;
    jumping.current = true;
    box.scrollTo({ top: Math.max(0, box.scrollTop + node.getBoundingClientRect().top - box.getBoundingClientRect().top - 4), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    setTimeout(() => { jumping.current = false; }, 420);
  }

  return <div className="emoji-sheet">
    <div className="emoji-head"><div className="emoji-tabs" role="tablist" aria-label="Emoji categories">
      {CATEGORIES.map(name => <button key={name} role="tab" aria-selected={active === name} aria-label={name === "love" ? "Love" : LABELS[name].name} onClick={() => jump(name)}>{name === "love" ? "💖" : LABELS[name].glyph}</button>)}
    </div></div>
    <div className="emoji-scroll" ref={scroller} onScroll={() => { if (!jumping.current) { const box = scroller.current; if (!box) return; const at = box.getBoundingClientRect().top + 18; let current = "love"; for (const name of CATEGORIES) { const node = sections.current[name]; if (node && node.getBoundingClientRect().top <= at) current = name; } if (current !== active) setActive(current); } }}>
          {grouped.recent.length > 0 && <section className="emoji-section" ref={node => { sections.current.recent = node; }}>
            <h4>Recent</h4>
            <div className="emoji-grid">{grouped.recent.map((glyph, index) => <button key={"r" + glyph + index} className="emoji-cell" aria-label={glyph} onClick={() => onPick(glyph)}>{glyph}</button>)}</div>
          </section>}
          {CATEGORIES.map(name => <section key={name} className="emoji-section" ref={node => { sections.current[name] = node; }}>
            <h4>{name === "love" ? "Love" : LABELS[name].name}</h4>
            <div className="emoji-grid">{grouped[name].map((glyph, index) => <button key={glyph + index} className="emoji-cell" aria-label={glyph} onClick={() => onPick(glyph)}>{glyph}</button>)}</div>
          </section>)}
    </div>
  </div>;
});
