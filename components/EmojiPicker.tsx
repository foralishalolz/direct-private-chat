"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { EMOJI_GROUPS, EMOJI_ROWS } from "@/lib/emoji-data";

/**
 * All 1,600+ emoji: one vertically scrolling sheet split into categories, with
 * a pinning tab strip and search that only appears when you ask for it. The
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const jumping = useRef(false);

  const grouped = useMemo(() => {
    const map: Record<string, string[]> = { love: LOVE, recent: recent.filter(glyph => !LOVE.includes(glyph)) };
    for (const name of EMOJI_GROUPS) map[name] = [];
    for (const [glyph, name] of EMOJI_ROWS) (map[name] ||= []).push(glyph);
    return map;
  }, [recent]);

  const needle = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (needle.length < 2) return null;
    const found: string[] = [];
    for (const [glyph, , keywords] of EMOJI_ROWS) {
      if (keywords.includes(needle)) { found.push(glyph); if (found.length >= 260) break; }
    }
    return found;
  }, [needle]);

  // Scrolling highlights the tab; tapping a tab scrolls to that section.
  useEffect(() => {
    if (hits || !jumping.current) return;
    const box = scroller.current;
    if (!box) return;
    const at = box.scrollTop + 14;
    let current = "love";
    for (const name of CATEGORIES) {
      const node = sections.current[name];
      if (node && node.offsetTop - 12 <= at) current = name;
    }
    setActive(current);
  }, [hits, active]);

  function jump(name: string) {
    setQuery(""); setSearchOpen(false); setActive(name);
    const node = sections.current[name], box = scroller.current;
    if (!node || !box) return;
    jumping.current = true;
    box.scrollTo({ top: Math.max(0, node.offsetTop - 12), behavior: "smooth" });
    setTimeout(() => { jumping.current = false; }, 420);
  }

  return <div className="emoji-sheet">
    <div className="emoji-head">
      {searchOpen
        ? <>
          <label className="emoji-search"><span aria-hidden="true">🔎</span><input autoFocus aria-label="Search emoji" placeholder="Search all emoji" value={query} maxLength={24} onChange={event => setQuery(event.target.value)}/></label>
          <button className="emoji-close" aria-label="Close search" onClick={() => { setQuery(""); setSearchOpen(false); }}>✕</button>
        </>
        : <>
          <div className="emoji-tabs" role="tablist" aria-label="Emoji categories">
            {CATEGORIES.map(name => <button key={name} role="tab" aria-selected={active === name} aria-label={name === "love" ? "Love" : LABELS[name].name} onClick={() => jump(name)}>
              {name === "love" ? "💖" : LABELS[name].glyph}
            </button>)}
          </div>
          <button className="emoji-close" aria-label="Search emoji" onClick={() => setSearchOpen(true)}>🔎</button>
        </>}
    </div>

    <div className="emoji-scroll" ref={scroller} onScroll={() => { if (!jumping.current && !hits) { const box = scroller.current; if (!box) return; const at = box.scrollTop + 14; let current = "love"; for (const name of CATEGORIES) { const node = sections.current[name]; if (node && node.offsetTop - 12 <= at) current = name; } if (current !== active) setActive(current); } }}>
      {hits ? (hits.length
        ? <div className="emoji-grid">{hits.map((glyph, index) => <button key={glyph + index} className="emoji-cell" aria-label={glyph} onClick={() => onPick(glyph)}>{glyph}</button>)}</div>
        : <p className="emoji-empty">No emoji matches “{query.trim()}”.</p>)
        : <>
          {grouped.recent.length > 0 && <section className="emoji-section" ref={node => { sections.current.recent = node; }}>
            <h4>Recent</h4>
            <div className="emoji-grid">{grouped.recent.map((glyph, index) => <button key={"r" + glyph + index} className="emoji-cell" aria-label={glyph} onClick={() => onPick(glyph)}>{glyph}</button>)}</div>
          </section>}
          {CATEGORIES.map(name => <section key={name} className="emoji-section" ref={node => { sections.current[name] = node; }}>
            <h4>{name === "love" ? "Love" : LABELS[name].name}</h4>
            <div className="emoji-grid">{grouped[name].map((glyph, index) => <button key={glyph + index} className="emoji-cell" aria-label={glyph} onClick={() => onPick(glyph)}>{glyph}</button>)}</div>
          </section>)}
        </>}
    </div>
  </div>;
});
