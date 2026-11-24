"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Archive, ArrowLeft, Bell, Bookmark, ChevronDown, Heart, Link2, MessageCircle, Search, SquarePen, Users, WifiOff, X } from "lucide-react";
import { watchDeviceMode, watchViewport } from "@/lib/device";
import { useEdgeSwipe } from "@/hooks/useEdgeSwipe";
import { usePullRefresh } from "@/hooks/usePullRefresh";
import { usePressFeedback, useTabBar } from "@/hooks/useTabBar";
import { haptic } from "@/lib/haptics";
import { useNotifications } from "@/hooks/useNotifications";
import { useAppBadge } from "@/hooks/useAppBadge";
import { useInbox } from "@/hooks/useInbox";
import { loadConversation } from "@/lib/conversation";
import { db, rpc } from "@/lib/supabase";
import { useDeepLink } from "@/lib/deeplink";
import { useIncomingCall } from "@/hooks/useIncomingCall";
import { useCall } from "@/hooks/useCall";
import { primeCallAudio } from "@/lib/callAudio";
import { clearCallNotification } from "@/lib/notifications";
import { upload } from "@/lib/media";
import { enqueue, announce } from "@/lib/offline";
import { useActivityPing, type ActivityKind } from "@/hooks/useActivityPing";
import type { ActivityTab } from "./Activities";
import { errorText, label, title, type Conversation, type Profile } from "@/lib/types";
import { Avatar, Brand, ErrorNote, IconButton, Spinner } from "./UI";
import SwipeChat from "./SwipeChat";

const ChatThread = dynamic(() => import("./ChatThread"), {
  loading: () => <section className="chat-thread thread-loading"><Spinner /></section>,
});
const Stories = dynamic(() => import("./Stories"));
const Discover = dynamic(() => import("./DiscoverModal"));
const ProfileEditor = dynamic(() => import("./ProfileModal"));
const ChatActionModal = dynamic(() => import("./ChatActionModal"));
const Journal = dynamic(() => import("./JournalModal"));
const NotificationSettings = dynamic(() => import("./NotificationsModal"));
const SavedModal = dynamic(() => import("./SavedModal"));
const CallSheet = dynamic(() => import("./CallSheet"), { ssr: false });

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
  const [activityIntent, setActivityIntent] = useState<{ conversationId: string; tab: ActivityTab; sequence: number } | null>(null);
  const activity = useActivityPing(profile, items, (conversationId, kind: ActivityKind) => {
    setSelected(conversationId);
    const tab = kind === "listen" ? "listen" : kind === "arcade" ? "arcade" : kind === "pet" ? "pet" : kind === "makeout" ? "makeout" : kind === "draw" ? "draw" : kind === "game" || kind === "wyr" ? "games" : kind === "kiss" ? "kiss" : "feels";
    setActivityIntent(current => ({ conversationId, tab, sequence: (current?.sequence ?? 0) + 1 }));
  });
  usePressFeedback();
  const tabs = useTabBar();
  // Returning from a lower chat must never leave the dock tucked away or the list in a stuck frame.
  useEffect(() => { if (!selected) tabs.reset(); }, [selected, tabs.reset]);
  const pull = usePullRefresh(() => refresh());
  useEdgeSwipe(() => setSelected(null), !!selected);
  // Home-screen shortcuts (?open=journal|us) land on the right sheet.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("open");
    if (wanted === "journal") setModal("journal");
    if (wanted === "profile") setModal("profile");
    if (wanted === "new") openDiscover();
    // "Us" needs a conversation, so land on the first couple chat and let the
    // thread open its own panel.
    if (wanted === "us") setSelected(current => current ?? items.find(row => row.kind === "direct" && row.couple_a && row.couple_b)?.id ?? null);
  }, [items]);
  const open = (id: string | null) => { haptic("light"); setSelected(id); };

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
  // Keep the call outside the selected thread so minimizing survives navigation.
  const [callConversation, setCallConversation] = useState<Conversation | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const callAudio = useRef<HTMLAudioElement>(null);
  const call = useCall(callConversation?.id ?? (active?.kind === "direct" ? active.id : null), profile.id);
  const incoming = useIncomingCall(profile.id, call.phase === "idle");
  useEffect(() => { if (call.call?.conversation_id) void clearCallNotification(profile.id, call.call.conversation_id).catch(() => {}); }, [profile.id, call.call?.id, call.call?.conversation_id, call.phase]);
  useEffect(() => { if (incoming.intent && call.phase === "idle") setSelected(incoming.intent.conversationId); }, [incoming.intent, call.phase]);
  useEffect(() => {
    if (call.phase !== "idle") {
      if (active && (!call.call || active.id === call.call.conversation_id)) setCallConversation(current => current ?? active);
      setCallOpen(true);
    }
  }, [call.phase, call.call?.conversation_id, active]);
  function startCall() {
    if (call.phase !== "idle") { setCallOpen(true); return; }
    if (!active || active.kind !== "direct") return;
    primeCallAudio(callAudio.current); setCallConversation(active); setCallOpen(true); void call.start("audio");
  }
  async function uploadCallAudio(file: File) {
    if (!callConversation || !file.type.startsWith("audio/")) throw new Error("Choose an audio file.");
    const path = await upload(profile.id, callConversation.id, file);
    const message = { id: crypto.randomUUID(), conversation_id: callConversation.id, user_id: profile.id, content: file.name.slice(0,120), media_url: path, media_kind: "audio" as const, kind: "message" as const, reply_to: null, instant_viewed: false, created_at: new Date().toISOString() };
    try { await enqueue(message); }
    catch (cause) {
      if (!navigator.onLine) throw cause;
      const result = await db().from("messages").insert({ id: message.id, conversation_id: message.conversation_id, user_id: message.user_id, content: message.content, media_url: path, media_kind: message.media_kind, kind: message.kind, reply_to: null }).select("*").single();
      if (result.error) throw result.error;
      announce(profile.id, result.data);
    }
  }
  const needle = search.trim().toLowerCase().replace(/^@/, "");
  const visible = items.filter(conversation =>
    (title(conversation) + " " + conversation.members?.map(member => member.username).join(" ")).toLowerCase().includes(needle)
    && (filter === "archived" ? conversation.archived : !conversation.archived && (filter === "all" || filter === "unread" && conversation.unread || filter === "groups" && conversation.kind === "group"))
  );
  const unread = items.filter(conversation => !conversation.archived && conversation.unread).length;
  const archivedCount = items.filter(conversation => conversation.archived).length;
  useAppBadge(unread);

  return (
    <main className={"app-shell " + (selected ? "has-thread " : "") + (tabs.hidden ? "tabs-hidden" : "")}>
      <audio ref={callAudio} autoPlay playsInline aria-hidden="true"/>
      <nav className="rail" aria-label="Main navigation">
        <a href="/" aria-label="BitchAt" className="rail-brand"><Brand small /></a>
        <IconButton label="Messages" className="active" onClick={() => open(null)}><MessageCircle size={24} /><span className="rail-label">Messages</span></IconButton>
        <IconButton label="New message" onClick={() => openDiscover()}><Users size={24} /><span className="rail-label">People</span></IconButton>
        <button className="rail-profile" aria-label="Profile" onClick={() => setModal("profile")}><Avatar profile={profile} size={36} /><span className="rail-label">Profile</span></button>
      </nav>

      <aside className="inbox">
        <header className="inbox-header">
          <div className="mobile-brand"><Brand small /></div>
          <div className="home-title"><h1>Messages{unread > 0 && <span className="inbox-count">{unread}</span>}</h1></div>
          <div className="inbox-header-actions"><IconButton label="Notifications" onClick={() => setModal("notifications")}><Bell size={21}/></IconButton><IconButton label="New message" className="new-chat-button" onClick={() => openDiscover()}><SquarePen size={22} /></IconButton></div>
        </header>
        <div className="inbox-search"><label className="input-icon"><Search size={18} aria-hidden="true" /><input aria-label="Search chats" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>

        {!needle && filter === "all" && <Stories profile={profile}/>}
        <div className="inbox-filters" aria-label="Filter chats">{[["all", "All"], ["unread", "Unread"], ["groups", "Groups"], ["archived", "Archived"]].map(([id, text]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => { setFilter(id); setRevealed(null); }}>{id === "archived" && <Archive size={15} aria-hidden="true"/>}{text}</button>)}</div>
        {filter !== "archived" && <div className="inbox-group-actions"><button onClick={() => openDiscover("group")}><Users size={16}/>New group</button><button onClick={() => openDiscover("join")}><Link2 size={16}/>Join group</button><button className="saved-shortcut" onClick={() => setModal("saved")}><Bookmark size={16}/>Saved</button></div>}
        {filter === "archived" && <div className="archive-intro"><span className="archive-intro-icon"><Archive size={21} aria-hidden="true"/></span><span><strong>Archived chats</strong><small>Kept private and out of your inbox. Swipe left or use more options to unarchive.</small></span></div>}
        <div className="pull-refresh" style={{ height: pull.pull }} aria-hidden={pull.pull === 0} role="status">
          {pull.busy ? <Spinner/> : pull.pull > 0 ? <span>{pull.pull >= 56 ? "Release to refresh" : "Pull to refresh"}</span> : null}
        </div>
        <div className="inbox-list-label"><span>{filter === "archived" ? "Archived" : "Messages"}</span><small>{filter === "archived" ? (archivedCount ? archivedCount + (more ? "+" : "") + (archivedCount === 1 && !more ? " chat" : " chats") : "") : unread ? unread + " unread" : ""}</small></div>
        <div className="conversation-list" onScroll={tabs.onScroll}>
          {loading && <div className="inbox-skeleton" aria-label="Loading chats" role="status">{[0, 1, 2, 3].map(index => <div key={index}><span /><i /></div>)}</div>}
          {visible.map(conversation => <SwipeChat key={conversation.id} conversation={conversation} selected={conversation.id === selected} open={revealed === conversation.id} busy={archiving !== null} onReveal={setRevealed} onOpen={open} onArchive={(id, archived) => void archive(id, archived)} onDelete={id => setChatAction({ id, action: "clear" })} />)}
          {!loading && !visible.length && (filter === "archived" ? <div className="empty-inbox"><span className="empty-inbox-icon"><Archive size={29} /></span><span>{needle ? "No chats found" : more ? "No archived chats on this page" : "No archived chats"}</span><small>{needle ? "Try a different search." : more ? "Load more chats to continue looking." : "Chats you archive will appear here."}</small></div> : <button className="empty-inbox" aria-label="Start a conversation" onClick={() => openDiscover()}><span className="empty-inbox-icon"><SquarePen size={29} /></span><span>{needle || filter !== "all" ? "No chats found" : "New message"}</span></button>)}
          {more && <IconButton label="More chats" onClick={() => void loadMore()}><ChevronDown size={20} /></IconButton>}
          <ErrorNote text={error} />
          <ErrorNote text={actionError} />
        </div>
        <footer className="inbox-footer">
          <button aria-label="Profile" onClick={() => setModal("profile")}><Avatar profile={profile} size={36} /><span><strong>{label(profile)}</strong><small>@{profile.username}</small></span></button>
          {!online && <WifiOff size={17} aria-label="Offline" />}
        </footer>
      </aside>

      {active ? <ChatThread key={active.id} conversation={active} profile={profile} activityIntent={activityIntent?.conversationId === active.id ? activityIntent : null} callIntent={incoming.intent?.conversationId === active.id ? incoming.intent : null} onCallIntentHandled={incoming.clear} call={call} onStartCall={startCall} onShowCall={()=>setCallOpen(true)} onBack={() => { setActivityIntent(null); open(null); }} onRefresh={refresh} /> : selected ? (
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
      {callOpen && callConversation && (call.phase !== "idle" || call.ended || call.error) && <CallSheet c={callConversation} session={call} remoteAudio={callAudio} onUploadAudio={uploadCallAudio} onClose={() => { setCallOpen(false); call.reset(); setCallConversation(null); }} />}
      {linkError && <div className="message-toast link-toast" role="status"><span>{linkError}</span><IconButton label="Dismiss" onClick={() => setLinkError("")}><X size={17}/></IconButton></div>}
      {notifications.toast && <div className="message-toast" role="status"><button onClick={() => { setSelected(notifications.toast); notifications.dismiss(); }}><MessageCircle size={20}/><span>New message</span></button><IconButton label="Dismiss notification" onClick={notifications.dismiss}><X size={17}/></IconButton></div>}
      {chatAction && <ChatActionModal conversationId={chatAction.id} userId={profile.id} action={chatAction.action} onClose={() => setChatAction(null)} onDone={async () => { if (selected === chatAction.id) { setSelected(null); setOpened(null); } await refresh(); }}/>}
      {modal === "new" && <Discover initialMode={discoverMode} userId={profile.id} onClose={() => setModal(null)} onOpen={id => { setSelected(id); void refresh(); }} />}
      {modal === "profile" && <ProfileEditor profile={profile} onChange={onProfile} onClose={() => setModal(null)} onLogout={onLogout} onJournal={() => setModal("journal")} />}
      {modal === "journal" && <Journal userId={profile.id} onClose={() => setModal(null)} />}
      {modal === "notifications" && <NotificationSettings userId={profile.id} onClose={() => setModal(null)} />}
      {modal === "saved" && <SavedModal userId={profile.id} onClose={() => setModal(null)} onOpenChat={id => open(id)} />}
    </main>
  );
}
