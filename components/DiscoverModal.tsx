"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Link2, Search, Sparkles, Users } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { errorText, label, type Profile } from "@/lib/types";
import { Avatar, ErrorNote, IconButton, Modal, Spinner } from "./UI";

type Mode = "direct" | "group" | "join";

const SHARE_BASE = "https://bitchwyat.vercel.app";

/** Public deep link for a profile. The app reads it on load and opens the chat. */
export const profileLink = (username: string) => SHARE_BASE + "/u/" + encodeURIComponent(username);

export default function DiscoverModal({ userId, onOpen, onClose, initialMode = "direct" }: { initialMode?: Mode; userId: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState(""), [results, setResults] = useState<Profile[]>([]), [selected, setSelected] = useState<Profile[]>([]);
  const [mode, setMode] = useState<Mode>(initialMode), [name, setName] = useState(""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [searching, setSearching] = useState(false), [error, setError] = useState("");
  const [linkFor, setLinkFor] = useState<Profile | null>(null), [copied, setCopied] = useState("");
  const generation = useRef(0), lock = useRef(false);

  useEffect(() => {
    const n = ++generation.current;
    setResults([]);
    if (mode === "join" || query.trim().replace(/^@/, "").length < 3) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void rpc<Profile[]>("find_profiles", { p_query: query.trim().replace(/^@/, "") })
        .then(rows => { if (n === generation.current) setResults(rows.filter(p => p.id !== userId)); })
        .catch(e => { if (n === generation.current) setError(errorText(e)); })
        .finally(() => { if (n === generation.current) setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); generation.current++; };
  }, [query, userId, mode]);

  async function open(person?: Profile) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const id = mode === "join" ? await rpc<string>("join_group", { p_code: code.trim().toLowerCase() })
        : mode === "group" ? await rpc<string>("create_group", { p_title: name.trim(), p_members: selected.map(p => p.id) })
        : await rpc<string>("open_conversation", { p_other: person!.id });
      onOpen(id); onClose();
    } catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  }

  const copy = useCallback(async (value: string, key: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(current => current === key ? "" : current), 1800); }
    catch (e) { setError(errorText(e)); }
  }, []);

  function toggle(person: Profile) {
    if (mode === "group") setSelected(previous => previous.some(x => x.id === person.id) ? previous.filter(x => x.id !== person.id) : previous.length < 15 ? [...previous, person] : previous);
    else void open(person);
  }

  const rows = needle(query) ? results : [];

  return <Modal title="New message" onClose={onClose}><div className="panel-pad">
    <div className="discover-modes">
      <button className={mode === "direct" ? "active" : ""} onClick={() => setMode("direct")}><Sparkles size={15} />People</button>
      <button aria-label="New group" className={mode === "group" ? "active" : ""} onClick={() => setMode("group")}><Users size={15} />Group</button>
      <button aria-label="Join group" className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}><Link2 size={15} />Join</button>
    </div>

    {mode === "join" ? <form className="join-form" onSubmit={e => { e.preventDefault(); void open(); }}>
      <input autoCapitalize="none" autoComplete="off" spellCheck={false} aria-label="Invite code" placeholder="Invite code" value={code} maxLength={32} onChange={e => { setCode(e.target.value.trim()); setError(""); }} />
      <button className="primary full spaced" disabled={busy || !/^[a-f0-9]{32}$/i.test(code)}>{busy ? <Spinner /> : <>Join group<ArrowRight size={18} /></>}</button>
    </form> : <>
      <label className="input-icon"><Search size={18} /><input autoCapitalize="none" autoComplete="off" aria-label="Search people" placeholder="@username or name" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setError(""); }} /></label>
      {mode === "group" && <>
        <input className="spaced" placeholder="Group name" aria-label="Group name" maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        <div className="chips">{selected.map(p => <button key={p.id} onClick={() => setSelected(previous => previous.filter(x => x.id !== p.id))}>@{p.username} ×</button>)}</div>
      </>}

      {!needle(query) && <p className="empty-label">Search by name or username (at least 3 characters).</p>}
      <div className="search-results">
        {searching ? <Spinner /> : rows.map(person => {
          const chosen = selected.some(x => x.id === person.id);
          return <div key={person.id} className={"person-row-wrap" + (chosen ? " chosen" : "")}>
            <button className="person-row" disabled={busy} onClick={() => toggle(person)}>
              <Avatar profile={person} />
              <span><strong>{label(person)}</strong><small>@{person.username}</small></span>
              {mode === "group" ? (chosen && <Check size={18} />) : <ArrowRight size={16} />}
            </button>
            <IconButton label={"Share link for " + label(person)} className="person-share" onClick={() => setLinkFor(person)}><Link2 size={16} /></IconButton>
          </div>;
        })}
        {!searching && needle(query) && !results.length && <p className="empty-label">No results</p>}
      </div>

      {mode === "group" && <button className="primary full" aria-label="Create group" disabled={busy || selected.length < 2 || !name.trim()} onClick={() => void open()}>{busy ? <Spinner /> : <ArrowRight size={22} />}</button>}
    </>}
    <ErrorNote text={error} />
  </div>

    {linkFor && <Modal title="Share profile" onClose={() => setLinkFor(null)}><div className="panel-pad share-sheet">
      <div className="share-person"><Avatar profile={linkFor} size={54} /><span><strong>{label(linkFor)}</strong><small>@{linkFor.username}</small></span></div>
      <p className="share-copy">Send this link. Whoever opens it lands straight on @{linkFor.username}&apos;s profile and can start a chat.</p>
      <div className="share-link"><input aria-label="Profile link" readOnly value={profileLink(linkFor.username)} onFocus={e => e.target.select()} /><IconButton label="Copy profile link" onClick={() => void copy(profileLink(linkFor.username), "profile")}>{copied === "profile" ? <Check size={18} /> : <Copy size={18} />}</IconButton></div>
      <button className="primary full" onClick={() => { const person = linkFor; setLinkFor(null); void open(person); }}><ArrowRight size={17} />Message @{linkFor.username}</button>
      <ErrorNote text={error} />
    </div></Modal>}
  </Modal>;
}

const needle = (value: string) => value.trim().replace(/^@/, "").length >= 3;
