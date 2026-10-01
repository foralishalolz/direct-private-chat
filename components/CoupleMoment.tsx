"use client";
import { useEffect, useRef, useState } from "react";
import { Heart, Plus, Sparkles } from "lucide-react";
import { db, rpc } from "@/lib/supabase";
import { AFFECTIONS, type AffectionId } from "@/lib/affection";
import { collectTreat, treatCollection, TREATS, TREAT_QUESTION } from "@/lib/treats";
import { errorText, label, type Conversation, type Poll, type Profile } from "@/lib/types";
import { useLive } from "@/hooks/useLive";
import { Avatar, ErrorNote, Spinner } from "./UI";

type Vote = { poll_id: string; user_id: string; choice: number };
export default function CoupleMoment({ c, p, onAffection }: { c: Conversation; p: Profile; onAffection: (id: AffectionId) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [celebrate, setCelebrate] = useState(false);
  const [collection, setCollection] = useState<string[]>([]);
  const lock = useRef(false), alive = useRef(true), roundId = useRef(crypto.randomUUID()), celebrated = useRef<string | null>(null);
  const live = useLive<{ poll: Poll | null; votes: Vote[] }>("sweet-match:" + c.id, ["polls", "poll_votes"], async () => {
    const result = await db().from("polls").select("*").eq("conversation_id", c.id).eq("question", TREAT_QUESTION).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    const poll = result.data as Poll | null;
    if (!poll) return { poll: null, votes: [] };
    const votes = await db().from("poll_votes").select("poll_id,user_id,choice").eq("poll_id", poll.id);
    if (votes.error) throw votes.error;
    return { poll, votes: (votes.data as Vote[]).filter(vote => vote.user_id === c.member_a || vote.user_id === c.member_b) };
  }, { poll: null, votes: [] });
  useEffect(() => { alive.current = true; setCollection(treatCollection(p.id, c.id).treats); return () => { alive.current = false; }; }, [c.id, p.id]);
  const poll = live.data.poll, mine = live.data.votes.find(vote => vote.user_id === p.id), theirs = live.data.votes.find(vote => vote.user_id !== p.id);
  const valid = poll?.question === TREAT_QUESTION && poll.options.length === TREATS.length && poll.options.every((option, i) => option === TREATS[i].option);
  const matched = !!valid && !!mine && !!theirs && mine.choice === theirs.choice && !!TREATS[mine.choice];
  const finished = !!mine && !!theirs, expired = !!poll && Date.parse(poll.closes_at) <= Date.now();
  useEffect(() => {
    setCelebrate(false);
    if (!poll || !matched || !mine || celebrated.current === poll.id) return;
    celebrated.current = poll.id;
    const previous = treatCollection(p.id, c.id);
    const next = collectTreat(p.id, c.id, poll.id, mine.choice); setCollection(next.treats);
    if (previous.rounds.includes(poll.id)) return;
    setCelebrate(true); const timer = setTimeout(() => setCelebrate(false), 1100);
    return () => clearTimeout(timer);
  }, [poll?.id, matched, mine?.choice, c.id, p.id]);
  async function act(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await work(); } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function start() {
    await rpc("create_poll", { p_id: roundId.current, p_conversation: c.id, p_question: TREAT_QUESTION, p_options: TREATS.map(treat => treat.option) });
    roundId.current = crypto.randomUUID(); if (alive.current) await live.refresh();
  }
  if (c.kind !== "direct" || !c.couple_a || !c.couple_b) return null;
  return <div className="couple-moment">
    <div className="moment-pair"><Avatar profile={p} size={54}/><span aria-hidden="true"><Heart size={24}/></span><Avatar profile={c.partner} size={54}/></div>
    <div className="moment-actions">{AFFECTIONS.filter(item => ["ask_kiss", "muah", "ask_hug", "ily"].includes(item.id)).map(item => <button disabled={busy} key={item.id} aria-label={item.label} onClick={() => void act(() => onAffection(item.id))}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}</div>
    <section className={"sweet-game" + (celebrate ? " treat-celebration" : "")} aria-label="Sweet match">
      <header><span><Sparkles size={17}/><h3>Sweet match</h3></span>{(!poll || finished || expired) && <button className="quiet-button" disabled={busy || live.loading} onClick={() => void act(start)}><Plus size={16}/>{poll ? "New round" : "Play"}</button>}</header>
      {live.loading ? <div className="center pad"><Spinner/></div> : !valid ? <div className="treat-start" aria-hidden="true">🍪 🍓 🍦</div> : <>
        <div className="treat-grid">{TREATS.map((treat, index) => <button key={treat.id} disabled={busy || expired} className={mine?.choice === index ? "chosen" : ""} aria-pressed={mine?.choice === index} aria-label={"Pick " + treat.label.toLowerCase()} onClick={() => void act(async () => { await rpc("vote_poll", { p_poll: poll!.id, p_choice: index }); if (alive.current) await live.refresh(); })}><span className="treat-emoji" aria-hidden="true">{treat.glyph}</span><small>{treat.label}</small></button>)}</div>
        <div className="treat-result" role="status">{matched ? <><span className="matched-treat" aria-hidden="true">{TREATS[mine!.choice].glyph}</span><strong>Sweet match</strong><small>Stamp collected</small></> : finished ? <><strong>A little of both</strong><small>{TREATS[mine!.choice]?.glyph} + {TREATS[theirs!.choice]?.glyph}</small></> : mine ? <small>Waiting for {label(c.partner)}</small> : <small>{expired ? "Round closed" : "Pick your treat"}</small>}</div>
      </>}
      <div className="treat-collection" aria-label="Treat stamps">{TREATS.map(treat => <span key={treat.id} aria-label={treat.label + (collection.includes(treat.id) ? " collected" : " not collected")} className={collection.includes(treat.id) ? "earned" : ""}>{treat.glyph}</span>)}</div>
    </section><ErrorNote text={error || live.error}/>
  </div>;
}
