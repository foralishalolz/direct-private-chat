"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {errorText,type Reaction} from "@/lib/types";

const key=(r:Pick<Reaction,"message_id"|"user_id">)=>r.message_id+":"+r.user_id;
type Change={row:Reaction|null;messageId:string;revision:number};

export function useReactions(conversationId:string,userId:string,messageIds:string[]){
  const [data,setData]=useState<Reaction[]>([]),[error,setError]=useState("");
  const base=useRef(new Map<string,Reaction>()),optimistic=useRef(new Map<string,Reaction|null>());
  const ids=useRef(new Set(messageIds)),loaded=useRef(new Set<string>()),fetching=useRef(new Set<string>()),again=useRef(new Set<string>());
  const changes=useRef(new Map<string,Change>()),revision=useRef(0),alive=useRef(false);
  ids.current=new Set(messageIds);
  const publish=useCallback(()=>{
    if(!alive.current)return;
    const result=new Map(base.current);
    for(const [id,row] of optimistic.current)if(row)result.set(id,row);else result.delete(id);
    const next=[...result.values()].filter(r=>ids.current.has(r.message_id));
    setData(previous=>previous.length===next.length&&previous.every((r,i)=>key(r)===key(next[i])&&r.emoji===next[i].emoji)?previous:next);
  },[]);
  const refresh=useCallback(async(requested:string[],force=false)=>{
    if(force)for(const id of requested)if(fetching.current.has(id))again.current.add(id);
    const targets=requested.filter(id=>ids.current.has(id)&&!fetching.current.has(id)&&(force||!loaded.current.has(id)));
    if(!targets.length)return;
    for(const id of targets)fetching.current.add(id);
    try{
      for(let i=0;i<targets.length;i+=100){
        const batch=targets.slice(i,i+100),wanted=new Set(batch),start=revision.current;
        const response=await db().from("reactions").select("message_id,user_id,emoji").eq("conversation_id",conversationId).in("message_id",batch);
        if(response.error)throw response.error;
        if(!alive.current)return;
        for(const [id,row] of base.current)if(wanted.has(row.message_id))base.current.delete(id);
        for(const row of response.data as Reaction[])if(ids.current.has(row.message_id))base.current.set(key(row),row);
        for(const [id,event] of changes.current)if(event.revision>start&&wanted.has(event.messageId)){
          if(event.row)base.current.set(id,event.row);else base.current.delete(id);
        }
        for(const id of batch)loaded.current.add(id);
        publish();
      }
      if(alive.current)setError("");
    }catch(e){if(alive.current)setError(errorText(e));}
    finally{
      const retry:string[]=[];
      for(const id of targets){fetching.current.delete(id);if(again.current.delete(id))retry.push(id);}
      if(alive.current&&retry.length)void refresh(retry,true);
    }
  },[conversationId,publish]);
  useEffect(()=>{
    alive.current=true;
    const receive=(row:Reaction|null,messageId:string,user:string)=>{
      if(!alive.current||!ids.current.has(messageId))return;
      const id=messageId+":"+user;
      changes.current.set(id,{row,messageId,revision:++revision.current});
      if(row)base.current.set(id,row);else base.current.delete(id);
      publish();
    };
    const client=db(),channel=client.channel("reactions:"+conversationId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}})
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"reactions",filter:"conversation_id=eq."+conversationId},e=>{const r=e.new as Reaction;receive(r,r.message_id,r.user_id);})
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"reactions",filter:"conversation_id=eq."+conversationId},e=>{const r=e.new as Reaction;receive(r,r.message_id,r.user_id);})
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"reactions"},e=>receive(null,String(e.old.message_id),String(e.old.user_id)))
      .subscribe(status=>{if(status==="SUBSCRIBED"&&alive.current)void refresh([...ids.current],true);});
    const focus=()=>{if(navigator.onLine&&document.visibilityState==="visible")void refresh([...ids.current],true);};
    window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);
    return()=>{alive.current=false;void client.removeChannel(channel);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);};
  },[conversationId,refresh,publish]);
  useEffect(()=>{
    for(const [id,row] of base.current)if(!ids.current.has(row.message_id))base.current.delete(id);
    for(const [id,event] of changes.current)if(!ids.current.has(event.messageId))changes.current.delete(id);
    for(const id of loaded.current)if(!ids.current.has(id))loaded.current.delete(id);
    publish();void refresh(messageIds);
  },[messageIds,publish,refresh]);
  const toggle=useCallback(async(messageId:string,emoji:string)=>{
    const id=messageId+":"+userId;
    if(optimistic.current.has(id))return;
    if(!navigator.onLine)throw new Error("Reconnect to react.");
    const next=base.current.get(id)?.emoji===emoji?null:{message_id:messageId,user_id:userId,emoji};
    optimistic.current.set(id,next);publish();
    try{
      await rpc("set_reaction",{p_message:messageId,p_emoji:next?.emoji??null});
      if(next)base.current.set(id,next);else base.current.delete(id);
      // Reconcile only this message; other members' events never reload the thread.
      await refresh([messageId],true);
    }finally{optimistic.current.delete(id);publish();}
  },[userId,publish,refresh]);
  const grouped=useMemo(()=>{
    const map=new Map<string,Reaction[]>();
    for(const row of data){const list=map.get(row.message_id);if(list)list.push(row);else map.set(row.message_id,[row]);}
    return map;
  },[data]);
  return{grouped,toggle,error};
}
