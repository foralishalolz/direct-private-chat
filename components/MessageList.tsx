"use client";
import {memo,useMemo} from "react";
import {day,type Conversation,type Message,type Profile,type Reaction} from "@/lib/types";
import MessageBubble from "./MessageBubble";

import type {AffectionId} from "@/lib/affection";
const EMPTY:Reaction[]=[];
type Props={messages:Message[];conversation:Conversation;profile:Profile;reactions:Map<string,Reaction[]>;now:number;onAffection:(id:AffectionId)=>Promise<void>;onReply:(message:Message)=>void;onReact:(id:string,emoji:string)=>Promise<void>;onEdit:(id:string,content:string)=>Promise<void>;onDelete:(id:string)=>Promise<void>;onRetry:(message:Message)=>Promise<void>};

export default memo(function MessageList({messages,conversation:c,profile:p,reactions,now,onAffection,onReply,onReact,onEdit,onDelete,onRetry}:Props){
  const byId=useMemo(()=>new Map(messages.map(m=>[m.id,m])),[messages]);
  const authors=useMemo(()=>new Map(c.members?.map(p=>[p.id,p])??[]),[c.members]);
  const dates=useMemo(()=>messages.map(m=>day(m.created_at)),[messages]);
  const readTime=c.kind==="direct"?(c.member_a===p.id?c.read_b:c.read_a):null;
  return <>{messages.map((m,i)=><div key={m.id}>
    {(i===0||dates[i-1]!==dates[i])&&<div className="date-divider">{dates[i]}</div>}
    <MessageBubble message={m} profile={p} author={c.kind==="group"?authors.get(m.user_id):undefined} reply={m.reply_to?byId.get(m.reply_to):undefined} reactions={reactions.get(m.id)??EMPTY} read={!!readTime&&m.created_at<=readTime} readCount={c.kind==="group"?(c.member_reads??[]).filter(r=>r.user_id!==m.user_id&&!!r.read_at&&r.read_at>=m.created_at).length:undefined} onAffection={onAffection} onReply={onReply} onReact={onReact} onEdit={onEdit} onDelete={onDelete} onRetry={onRetry} now={now}/>
  </div>)}</>;
});
