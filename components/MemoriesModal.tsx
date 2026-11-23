"use client";

import { Heart, ImageIcon, Sparkles } from "lucide-react";
import { useLive } from "@/hooks/useLive";
import { rpc } from "@/lib/supabase";
import { day, label, title, type Conversation, type Profile } from "@/lib/types";
import { Avatar, ErrorNote, Modal, Spinner } from "./UI";

type Memory = { id: string; media_url: string | null; media_kind: string | null; content: string; created_at: string };
type Story = {
  started_at: string | null;
  total: number;
  mine: number;
  photos: number;
  misses: number;
  kisses: number;
  pet_a: string | null;
  pet_b: string | null;
  first: { content: string; kind: string; created_at: string; user_id: string; media_url: string | null } | null;
  recent: Memory[];
};

const EMPTY: Story = { started_at: null, total: 0, mine: 0, photos: 0, misses: 0, kisses: 0, pet_a: null, pet_b: null, first: null, recent: [] };

function sinceText(iso: string | null) {
  if (!iso) return "";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days < 1) return "Started today";
  if (days === 1) return "1 day together";
  if (days < 60) return days + " days together";
  if (days < 730) return Math.floor(days / 30) + " months together";
  return (days / 365).toFixed(1) + " years together";
}

/**
 * Shared story: numbers, the first message, and the most recent photo or
 * "I miss you" moments. Only values the couple can already read are shown.
 */
export default function MemoriesModal({ c, p, onClose }: { c: Conversation; p: Profile; onClose: () => void }) {
  const live = useLive<Story>("memories:" + c.id, ["messages", "kiss_meter"], async () => {
    const story = await rpc<Story>("couple_memories", { p_conversation: c.id });
    return { ...EMPTY, ...story, recent: story.recent ?? [] };
  }, EMPTY);
  const story = live.data;
  // pet_a names member_b; the partner's side tells us which column is mine.
  const theirPetName = c.partner ? (c.partner.id === c.member_b ? story.pet_a : story.pet_b) : null;
  const myPetName = c.partner ? (c.partner.id === c.member_b ? story.pet_b : story.pet_a) : null;
  const share = story.total ? Math.round((story.mine / story.total) * 100) : 0;

  return (
    <Modal title="Memories" wide onClose={onClose}>
      <div className="panel-pad memories">
        <header className="memories-head">
          <div className="moment-pair"><Avatar profile={p} size={50} /><span aria-hidden="true"><Heart size={20} /></span><Avatar profile={c.partner} size={50} /></div>
          <h3>{title(c)}</h3>
          <small>{sinceText(story.started_at) || "Your story starts with the first message"}</small>
          {(myPetName || theirPetName) && <p className="memories-pets">{theirPetName ? "You are " + theirPetName : ""}{theirPetName && myPetName ? " · " : ""}{myPetName ? "They are " + myPetName : ""}</p>}
        </header>

        <div className="memories-stats">
          {([["Messages", story.total], ["Photos", story.photos], ["Miss you", story.misses], ["Kisses", story.kisses]] as const).map(([name, value]) => (
            <div key={name}><strong>{value.toLocaleString()}</strong><small>{name}</small></div>
          ))}
        </div>

        {story.total > 0 && <div className="memories-balance" role="img" aria-label={`You sent ${share}% of the messages`}>
          <span style={{ width: share + "%" }} /><small>{share}% of the words are yours</small>
        </div>}

        {story.first && <section className="memories-first">
          <small><Sparkles size={13} /> The very first message</small>
          <p>{story.first.content || (story.first.media_url ? "A photo" : story.first.kind === "miss" ? "🤍 I miss you" : "A sticker")}</p>
          <time dateTime={story.first.created_at}>{day(story.first.created_at)} · {story.first.user_id === p.id ? "you" : label(c.partner)}</time>
        </section>}

        <section className="memories-recent">
          <small>Last 24 hours</small>
          {story.recent.length ? <div className="memories-grid">{story.recent.map(item => (
            <div key={item.id} className="memories-tile">
              {item.media_url ? <span className="memories-photo"><ImageIcon size={18} /></span>
                : <span className="memories-emoji" aria-hidden="true">{item.content.slice(0, 2) || "💌"}</span>}
              <time dateTime={item.created_at}>{day(item.created_at)}</time>
            </div>
          ))}</div> : <p className="empty-label">Photos and miss-yous will collect here.</p>}
        </section>
        {(live.loading || live.error) && <div className="center pad">{live.loading ? <Spinner /> : <ErrorNote text={live.error} />}</div>}
      </div>
    </Modal>
  );
}

