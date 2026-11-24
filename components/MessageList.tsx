"use client";
import {memo,useMemo} from "react";
import {Phone, PhoneMissed} from "lucide-react";
import {callLabel, type CallRow} from "@/lib/rtc";
import {day,type Conversation,type Message,type Profile,type Reaction} from "@/lib/types";
import MessageBubble from "./MessageBubble";

import type {AffectionId} from "@/lib/affection";
const EMPTY:Reaction[]=[];
type Props={messages:Message[];conversation:Conversation;profile:Profile;reactions:Map<string,Reaction[]>;now:number;onAffection:(id:AffectionId)=>Promise<void>;onReply:(message:Message)=>void;onReact:(id:string,emoji:string)=>Promise<void>;onEdit:(id:string,content:string)=>Promise<void>;onDelete:(id:string)=>Promise<void>;onRetry:(message:Message)=>Promise<void>;pinnedIds?:Set<string>;onPin?:(id:string,pinned:boolean)=>Promise<void>;savedIds?:Set<string>;onSave?:(m:Message)=>Promise<void>;onShareLink?:(url:string)=>void;calls?:CallRow[];onCall?:()=>void};

export default memo(function MessageList({messages,conversation:c,profile:p,reactions,now,onAffection,onReply,onReact,onEdit,onDelete,onRetry,pinnedIds,onPin,savedIds,onSave,onShareLink,calls=[],onCall}:Props){
  const byId=useMemo(()=>new Map(messages.map(m=>[m.id,m])),[messages]);
  const authors=useMemo(()=>new Map(c.members?.map(p=>[p.id,p])??[]),[c.members]);
  const timeline=useMemo(() => [
    ...messages.map(message => ({kind:"message" as const, at:message.created_at, message})),
    ...calls.map(call => ({kind:"call" as const, at:call.started_at, call})),
  ].sort((a,b)=>a.at.localeCompare(b.at)),[messages,calls]);
  const dates=useMemo(()=>timeline.map(item=>day(item.at)),[timeline]);
  const readTime=c.kind==="direct"?(c.member_a===p.id?c.read_b:c.read_a):null;
  return <>{timeline.map((item,i)=><div key={item.kind+":"+(item.kind==="message"?item.message.id:item.call.id)}>
    {(i===0||dates[i-1]!==dates[i])&&<div className="date-divider">{dates[i]}</div>}
    {item.kind === "call" ? <div className={"chat-call-card "+(item.call.status === "missed" && item.call.callee === p.id ? "missed" : "")}>
      <span className="chat-call-icon">{item.call.status === "missed" && item.call.callee === p.id ? <PhoneMissed size={21}/> : <Phone size={21}/>}</span>
      <span className="chat-call-copy"><strong>{item.call.status === "missed" && item.call.callee === p.id ? "Missed voice call" : item.call.caller === p.id ? "Outgoing voice call" : "Incoming voice call"}</strong><small>{new Date(item.call.started_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} · {callLabel(item.call)}</small></span>
      {onCall && <button onClick={onCall} aria-label="Call back"><Phone size={18}/></button>}
    </div> : <MessageBubble message={item.message} profile={p} author={c.kind==="group"?authors.get(item.message.user_id):undefined} reply={item.message.reply_to?byId.get(item.message.reply_to):undefined} reactions={reactions.get(item.message.id)??EMPTY} read={!!readTime&&item.message.created_at<=readTime} readCount={c.kind==="group"?(c.member_reads??[]).filter(r=>r.user_id!==item.message.user_id&&!!r.read_at&&r.read_at>=item.message.created_at).length:undefined} onAffection={onAffection} onReply={onReply} onReact={onReact} onEdit={onEdit} onDelete={onDelete} onRetry={onRetry} now={now} pinned={pinnedIds?.has(item.message.id)} onPin={onPin} onSave={onSave} onShareLink={onShareLink} saved={savedIds?.has(item.message.id)}/>}
  </div>)}</>;
});
