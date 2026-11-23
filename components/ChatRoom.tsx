"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Archive, ArrowLeft, Bell, BookHeart, Bookmark, ChevronDown, Heart, Link2, MessageCircle, Search, SquarePen, Users, WifiOff, X } from "lucide-react";
import { watchDeviceMode, watchViewport } from "@/lib/device";
import { useEdgeSwipe } from "@/hooks/useEdgeSwipe";
import { usePullRefresh } from "@/hooks/usePullRefresh";
import { usePressFeedback, useTabBar } from "@/hooks/useTabBar";
import { haptic } from "@/lib/haptics";
import { useNotifications } from "@/hooks/useNotifications";
import { useAppBadge } from "@/hooks/useAppBadge";
import { useInbox } from "@/hooks/useInbox";
import { loadConversation } from "@/lib/conversation";
import { rpc } from "@/lib/supabase";
import { useDeepLink } from "@/lib/deeplink";
import { useIncomingCall } from "@/hooks/useIncomingCall";
import { errorText, label, title, type Conversation, type Profile } from "@/lib/types";
import { Avatar, Brand, ErrorNote, IconButton, Spinner } from "./UI";
import SwipeChat from "./SwipeChat";

const ChatThread = dynamic(() => import("./ChatThread"), {
  loading: () => <section className="chat-thread thread-loading"><Spinner /></section>,
});
const Discover = dynamic(() => import("./DiscoverModal"));
const ProfileEditor = dynamic(() => import("./ProfileModal"));
const ChatActionModal = dynamic(() => import("./ChatActionModal"));
const Journal = dynamic(() => import("./JournalModal"));
const NotificationSettings = dynamic(() => import("./NotificationsModal"));
const SavedModal = dynamic(() => import("./SavedModal"));

export default function ChatRoom({ profile, onProfile, onLogout }: {
  profile: Profile;
  onProfile: (profile: Profile) => void;
  onLogout: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const notifications = useNotifications(profile.id, selected, setSelected);
  const { items, loading, more, error, refresh, loadMore, setArchived } = useInbox(profile.id, notifications.onMessage);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [chatAction, setChatAction] = useState<{ id: string; action: "clear" | "leave" } | null>(null);
  const [discoverMode, setDiscoverMode] = useState<"direct" | "group" | "join">("direct");
  const [opened, setOpened] = useState<Conversation | null>(null);
  const [openError, setOpenError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState<"new" | "profile" | "journal" | "notifications" | "saved" | null>(null);
  const [online, setOnline] = useState(true);
  const [linkError, setLinkError] = useState("");
  const [linkName, setLinkName] = useState("");
  useDeepLink(username => setLinkName(username), true);
  const incoming = useIncomingCall(profile.id);
  usePressFeedback();
  const tabs = useTabBar();
  const pull = usePullRefresh(() => refresh());
  useEdgeSwipe(() => setSelected(null), !!selected);
  // Home-screen shortcuts (?open=journal|us) land on the right sheet.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("open");
    if (wanted === "journal") setModal("journal");
    if (wanted === "profile") setModal("profile");
    if (wanted === "new") openDiscover();
  }, []);
  const open = (id: string | null) => { haptic("light"); setSelected(id); };
  // Answer / decline from a notification or a `?call=` launch.
  useEffect(() => {
    if (!incoming.intent) return;
    setSelected(incoming.intent.conversationId);
    window.dispatchEvent(new CustomEvent("bitchat-call-intent", { detail: incoming.intent }));
    incoming.clear();
  }, [incoming.intent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!linkName) return;
    let current = true;
    setLinkError("");
    void (async () => {
      try {
        const rows = await rpc<{ id: string }[]>("profile_by_username", { p_username: linkName });
        const found = rows?.[0];
        if (!found) throw new Error("No one here is called @" + linkName + " yet.");
        if (found.id === profile.id) throw new Error("That link is your own profile.");
        const id = await rpc<string>("open_conversation", { p_other: found.id });
        if (!current) return;
        setSelected(id);
        await refresh();
        setLinkName("");
        window.history.replaceState(null, "", "/");
      } catch (cause) {
        if (current) { setLinkError(errorText(cause)); setLinkName(""); }
      }
    })();
    return () => { current = false; };
  }, [linkName, profile.id, refresh]);
  useEffect(() => watchDeviceMode(profile.id), [profile.id]);
  useEffect(() => watchViewport(), []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  function openDiscover(mode: "direct" | "group" | "join" = "direct") { setDiscoverMode(mode); setModal("new"); }

  async function archive(id: string, archived: boolean) {
    if (archiving) return;
    setArchiving(id); setActionError("");
    try { await setArchived(id, archived); setRevealed(null); }
    catch (cause) { setActionError(errorText(cause)); }
    finally { setArchiving(null); }
  }

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
    && (filter === "archived" ? conversation.archived : !conversation.archived && (filter === "all" || filter === "unread" && conversation.unread || filter === "groups" && conversation.kind === "group"))
  );
  const recent = items.filter(conversation => !conversation.archived && conversation.kind === "direct" && conversation.partner).slice(0, 8);
  const unread = items.filter(conversation => !conversation.archived && conversation.unread).length;
  useAppBadge(unread);

  return (
    <main className={"app-shell " + (selected ? "has-thread " : "") + (tabs.hidden ? "tabs-hidden" : "")}>
      <nav className="rail" aria-label="Main navigation">
        <a href="/" aria-label="BitchAt" className="rail-brand"><Brand small /></a>
        <IconButton label="Messages" className="active" onClick={() => open(null)}><MessageCircle size={24} /><span className="rail-label">Messages</span></IconButton>
        <IconButton label="New message" onClick={() => openDiscover()}><Users size={24} /><span className="rail-label">People</span></IconButton>
        <IconButton label="Journal" onClick={() => setModal("journal")}><BookHeart size={24} /><span className="rail-label">Journal</span></IconButton>
        <button className="rail-profile" aria-label="Profile" onClick={() => setModal("profile")}><Avatar profile={profile} size={36} /><span className="rail-label">Profile</span></button>
      </nav>

      <aside className="inbox">
        <header className="inbox-header">
          <div className="mobile-brand"><Brand small /></div>
          <h1>Messages{unread > 0 && <span className="inbox-count">{unread}</span>}</h1>
          <div className="inbox-header-actions"><IconButton label="Notifications" onClick={() => setModal("notifications")}><Bell size={21}/></IconButton><IconButton label="New message" className="new-chat-button" onClick={() => openDiscover()}><SquarePen size={22} /></IconButton></div>
        </header>
        <div className="inbox-search"><label className="input-icon"><Search size={18} aria-hidden="true" /><input aria-label="Search chats" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>

        {!needle && filter === "all" && recent.length > 0 && <div className="recent-people" aria-label="Recent chats">
          {recent.map(conversation => <button key={conversation.id} aria-label={"Open chat with " + label(conversation.partner)} onClick={() => open(conversation.id)}>
            <span className="recent-ring"><Avatar profile={conversation.partner} size={51} />{conversation.partner?.mood && <span className="recent-mood">{conversation.partner.mood}</span>}</span>
            <span className="recent-name">{label(conversation.partner)}</span>
          </button>)}
        </div>}

        <div className="inbox-filters" aria-label="Filter chats">{[["all", "All"], ["unread", "Unread"], ["groups", "Groups"], ["archived", "Archived"]].map(([id, text]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => { setFilter(id); setRevealed(null); }}>{text}</button>)}</div>
        <div className="inbox-group-actions"><button onClick={() => openDiscover("group")}><Users size={16}/>New group</button><button onClick={() => openDiscover("join")}><Link2 size={16}/>Join group</button><button className="saved-shortcut" onClick={() => setModal("saved")}><Bookmark size={16}/>Saved</button></div>
        <div className="pull-refresh" style={{ height: pull.pull }} aria-hidden={pull.pull === 0} role="status">
          {pull.busy ? <Spinner/> : pull.pull > 0 ? <span>{pull.pull >= 56 ? "Release to refresh" : "Pull to refresh"}</span> : null}
        </div>
        <div className="conversation-list" onScroll={tabs.onScroll}>
          {loading && <div className="inbox-skeleton" aria-label="Loading chats" role="status">{[0, 1, 2, 3].map(index => <div key={index}><span /><i /></div>)}</div>}
          {visible.map(conversation => <SwipeChat key={conversation.id} conversation={conversation} selected={conversation.id === selected} open={revealed === conversation.id} busy={archiving !== null} onReveal={setRevealed} onOpen={open} onArchive={(id, archived) => void archive(id, archived)} onDelete={id => setChatAction({ id, action: "clear" })} />)}
          {!loading && !visible.length && (filter === "archived" ? <div className="empty-inbox"><span className="empty-inbox-icon"><Archive size={29} /></span><span>No archived chats</span></div> : <button className="empty-inbox" aria-label="Start a conversation" onClick={() => openDiscover()}><span className="empty-inbox-icon"><SquarePen size={29} /></span><span>{needle || filter !== "all" ? "No chats found" : "New message"}</span></button>)}
          {more && <IconButton label="More chats" onClick={() => void loadMore()}><ChevronDown size={20} /></IconButton>}
          <ErrorNote text={error} />
          <ErrorNote text={actionError} />
        </div>
        <footer className="inbox-footer">
          <button aria-label="Profile" onClick={() => setModal("profile")}><Avatar profile={profile} size={36} /><span><strong>{label(profile)}</strong><small>@{profile.username}</small></span></button>
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
          <button className="primary" onClick={() => openDiscover()}><SquarePen size={18} />New message</button>
        </section>
      )}
      {linkError && <div className="message-toast link-toast" role="status"><span>{linkError}</span><IconButton label="Dismiss" onClick={() => setLinkError("")}><X size={17}/></IconButton></div>}
      {notifications.toast && <div className="message-toast" role="status"><button onClick={() => { setSelected(notifications.toast); notifications.dismiss(); }}><MessageCircle size={20}/><span>New message</span></button><IconButton label="Dismiss notification" onClick={notifications.dismiss}><X size={17}/></IconButton></div>}
      {chatAction && <ChatActionModal conversationId={chatAction.id} userId={profile.id} action={chatAction.action} onClose={() => setChatAction(null)} onDone={async () => { if (selected === chatAction.id) { setSelected(null); setOpened(null); } await refresh(); }}/>}
      {modal === "new" && <Discover initialMode={discoverMode} userId={profile.id} onClose={() => setModal(null)} onOpen={id => { setSelected(id); void refresh(); }} />}
      {modal === "profile" && <ProfileEditor profile={profile} onChange={onProfile} onClose={() => setModal(null)} onLogout={onLogout} />}
      {modal === "journal" && <Journal userId={profile.id} onClose={() => setModal(null)} />}
      {modal === "notifications" && <NotificationSettings userId={profile.id} onClose={() => setModal(null)} />}
      {modal === "saved" && <SavedModal userId={profile.id} onClose={() => setModal(null)} onOpenChat={id => open(id)} />}
    </main>
  );
}
