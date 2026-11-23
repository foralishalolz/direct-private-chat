"use client";

import { useState } from "react";
import { ArrowUpRight, Shuffle } from "lucide-react";
import { DARES, QUESTIONS, RATHERS, SOFT_QUESTIONS, SPICY_QUESTIONS } from "@/lib/couple";
import { haptic } from "@/lib/haptics";
import { errorText } from "@/lib/types";
import { ErrorNote } from "./UI";

const decks = {
  together: { name: "Us", icon: "💞", cards: QUESTIONS },
  gentle: { name: "Gentle", icon: "🫂", cards: SOFT_QUESTIONS },
  rather: { name: "Rather", icon: "✨", cards: RATHERS.map(([a, b]) => `Would you rather ${a.toLowerCase()} or ${b.toLowerCase()}?`) },
  dare: { name: "Dares", icon: "💋", cards: DARES.map(item => item.text) },
  spicy: { name: "After dark · 18+", icon: "🌶️", cards: SPICY_QUESTIONS },
} as const;
type Deck = keyof typeof decks;

export default function QuestionDeck({ onSend }: { onSend: (line: string) => Promise<void> }) {
  const [deck, setDeck] = useState<Deck>("together");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const cards = decks[deck].cards;

  function shuffle(next: Deck = deck) {
    const length = decks[next].cards.length;
    const offset = next === deck && length > 1 ? 1 + Math.floor(Math.random() * (length - 1)) : Math.floor(Math.random() * length);
    setIndex(next === deck ? (index + offset) % length : offset);
    setDeck(next); setStatus(""); setError(""); haptic("light");
  }
  async function share() {
    if (busy) return;
    setBusy(true); setError("");
    try { await onSend(`${decks[deck].icon} ${cards[index]}`); setStatus("Added to your chat 💌"); haptic("success"); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <section className="question-deck" aria-label="Question cards">
    <div className="deck-heading"><div><span className="deck-eyebrow">A LITTLE SPARK ✦</span><h3>Pick a question</h3></div><span className="deck-orb" aria-hidden="true">💌</span></div>
    <div className="deck-tabs" role="group" aria-label="Question deck">
      {(Object.keys(decks) as Deck[]).map(key => <button key={key} aria-pressed={deck === key} onClick={() => shuffle(key)}>{decks[key].icon} {decks[key].name}</button>)}
    </div>
    <div className="deck-card" key={deck + index}>
      <span className="deck-card-label">{decks[deck].icon} {decks[deck].name} · {index + 1}/{cards.length}</span>
      <p>{cards[index]}</p>
      <small>{deck === "dare" || deck === "spicy" ? "For consenting adults. Skip anything you like." : "Pick one to send."}</small>
    </div>
    <div className="deck-actions"><button onClick={() => shuffle()}><Shuffle size={16}/> Shuffle</button><button className="deck-send" disabled={busy} onClick={() => void share()}>Send to chat <ArrowUpRight size={16}/></button></div>
    <small role="status" className="deck-status">{status}</small><ErrorNote text={error}/>
  </section>;
}
