"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, BookHeart, ChevronDown, Heart, MessageCircle, Search, SquarePen, Users, WifiOff } from "lucide-react";
import { useInbox } from "@/hooks/useInbox";
import { loadConversation } from "@/lib/conversation";
import { errorText, label, time, title, type Conversation, type Profile } from "@/lib/types";
import { Avatar, Brand, ErrorNote, IconButton, Spinner } from "./UI";

const ChatThread = dynamic(() => import("./ChatThread"), {
  loading: () => <section className="chat-thread thread-loading"><Spinner /></section>,
});
const Discover = dynamic(() => import("./DiscoverModal"));
const ProfileEditor = dynamic(() => import("./ProfileModal"));
const Journal = dynamic(() => import("./JournalModal"));

export default function ChatRoom({ profile, onProfile, onLogout }: {
  profile: Profile;
  onProfile: (profile: Profile) => void;
  onLogout: () => Promise<void>;
}) {
  const { items, loading, more, error, refresh, loadMore } = useInbox(profile.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<Conversation | null>(null);
  const [openError, setOpenError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState<"new" | "profile" | "journal" | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const inInbox = items.find(conversation => conversation.id === selected);
  useEffect(() => {
    let current = true;
    setOpenError("");
    if (!selected || inInbox) return;
    setOpened(null);
    void loadConversation(selected, profile.id).then(conversation => {
      if (current) setOpened(conversation);
    }).catch(cause => { if (current) setOpenError(errorText(cause)); });
    return () => { current = false; };
  }, [selected, inInbox, profile.id, retry]);

  const active = inInbox ?? (opened?.id === selected ? opened : null);
  const needle = search.trim().toLowerCase().replace(/^@/, "");
  const visible = items.filter(conversation =>
    (title(conversation) + " " + conversation.members?.map(member => member.username).join(" ")).toLowerCase().includes(needle)
    && (filter === "all" || filter === "unread" && conversation.unread || filter === "groups" && conversation.kind === "group")
  );
  const recent = items.filter(conversation => conversation.kind === "direct" && conversation.partner).slice(0, 8);

  return (
    <main className={"app-shell " + (selected ? "has-thread" : "")}>
      <nav className="rail" aria-label="Main navigation">
        <a href="/" aria-label="BitchAt" className="rail-brand"><Brand small /></a>
        <IconButton label="Messages" className="active" onClick={() => setSelected(null)}><MessageCircle size={24} /><span className="rail-label">Messages</span></IconButton>
        <IconButton label="New message" onClick={() => setModal("new")}><Users size={24} /><span className="rail-label">People</span></IconButton>
        <IconButton label="Journal" onClick={() => setModal("journal")}><BookHeart size={24} /><span className="rail-label">Journal</span></IconButton>
        <button className="rail-profile" aria-label="Profile" onClick={() => setModal("profile")}><Avatar profile={profile} size={36} /><span className="rail-label">Profile</span></button>
      </nav>

      <aside className="inbox">
        <header className="inbox-header">
          <div className="mobile-brand"><Brand small /></div>
          <h1>Messages</h1>
          <IconButton label="New message" onClick={() => setModal("new")}><SquarePen size={24} /></IconButton>
        </header>
        <div className="inbox-search"><label className="input-icon"><Search size={18} aria-hidden="true" /><input aria-label="Search chats" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>

        {!needle && filter === "all" && recent.length > 0 && <div className="recent-people" aria-label="Recent chats">
          {recent.map(conversation => <button key={conversation.id} aria-label={"Open chat with " + label(conversation.partner)} onClick={() => setSelected(conversation.id)}>
            <span className="recent-ring"><Avatar profile={conversation.partner} size={51} />{conversation.partner?.mood && <span className="recent-mood">{conversation.partner.mood}</span>}</span>
            <span className="recent-name">{label(conversation.partner)}</span>
          </button>)}
        </div>}

        <div className="inbox-filters" aria-label="Filter chats">{[["all", "All"], ["unread", "Unread"], ["groups", "Groups"]].map(([id, text]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{text}</button>)}</div>
        <div className="conversation-list">
          {loading && <div className="inbox-skeleton" aria-label="Loading chats" role="status">{[0, 1, 2, 3].map(index => <div key={index}><span /><i /></div>)}</div>}
          {visible.map(conversation => <button key={conversation.id} className={"conversation " + (conversation.id === selected ? "selected" : "")} onClick={() => setSelected(conversation.id)}>
            <span className="avatar-wrap"><Avatar profile={conversation.partner} group={conversation.kind === "group"} size={49} />{conversation.partner?.mood && <span className="mood-badge">{conversation.partner.mood}</span>}</span>
            <span className="conversation-copy">
              <span className="row"><strong>{title(conversation)}</strong><small className="push">{time(conversation.last_activity)}</small></span>
              <span className="row"><span className={"preview " + (conversation.unread ? "unread" : "")}>{conversation.preview || (conversation.kind === "group" ? String(conversation.members?.length ?? 0) + " members" : "@" + (conversation.partner?.username ?? ""))}</span>{conversation.unread && <i className="unread-dot" />}</span>
            </span>
          </button>)}
          {!loading && !visible.length && <button className="empty-inbox" aria-label="Start a conversation" onClick={() => setModal("new")}><span className="empty-inbox-icon"><SquarePen size={29} /></span><span>{needle || filter !== "all" ? "No chats found" : "New message"}</span></button>}
          {more && <IconButton label="More chats" onClick={() => void loadMore()}><ChevronDown size={20} /></IconButton>}
          <ErrorNote text={error} />
        </div>
        <footer className="inbox-footer">
          <button onClick={() => setModal("profile")}><Avatar profile={profile} size={36} /><span><strong>{label(profile)}</strong><small>@{profile.username}</small></span></button>
          <IconButton label="Journal" onClick={() => setModal("journal")}><BookHeart size={23} /></IconButton>
          {!online && <WifiOff size={17} aria-label="Offline" />}
        </footer>
      </aside>

      {active ? <ChatThread key={active.id} conversation={active} profile={profile} onBack={() => setSelected(null)} onRefresh={refresh} /> : selected ? (
        <section className="chat-thread thread-loading" aria-label="Opening conversation">
          <IconButton label="Back to messages" className="opening-back" onClick={() => setSelected(null)}><ArrowLeft size={23} /></IconButton>
          {openError ? <div className="opening-error"><ErrorNote text={openError} /><button className="primary" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : <Spinner />}
        </section>
      ) : (
        <section className="thread-empty">
          <span className="empty-glyph"><MessageCircle size={49} strokeWidth={1.3} /><Heart size={20} /></span>
          <h2>Your messages</h2>
          <button className="primary" onClick={() => setModal("new")}><SquarePen size={18} />New message</button>
        </section>
      )}
      {modal === "new" && <Discover userId={profile.id} onClose={() => setModal(null)} onOpen={id => { setSelected(id); void refresh(); }} />}
      {modal === "profile" && <ProfileEditor profile={profile} onChange={onProfile} onClose={() => setModal(null)} onLogout={onLogout} />}
      {modal === "journal" && <Journal userId={profile.id} onClose={() => setModal(null)} />}
    </main>
  );
}
