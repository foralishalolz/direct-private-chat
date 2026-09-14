"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {db} from "@/lib/supabase";
import {acknowledge,announce,cache,cached,cacheable,enqueue,pending} from "@/lib/offline";
import {errorText,merge,type Message} from "@/lib/types";
export function useMessages(conversationId:string,userId:string){
  const [messages,setMessages]=useState<Message[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(true),[older,setOlder]=useState(false),[connected,setConnected]=useState(false),[error,setError]=useState("");
  const rows=useRef<Message[]>([]),events=useRef(new Map<string,{row:Message|null;revision:number}>()),revision=useRef(0),alive=useRef(false),refreshing=useRef(false),paging=useRef(false),lastSync=useRef(0);
  useLayoutEffect(()=>{rows.current=messages;},[messages]);
  const reconcile=useCallback(async()=>{
    if(refreshing.current||!navigator.onLine)return;
    refreshing.current=true;const start=revision.current;
    try{
      const result=await db().from("messages").select("*").eq("conversation_id",conversationId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30);
      if(result.error)throw result.error;
      const latest=result.data as Message[];
      const ids=rows.current.filter(m=>!m.status&&!latest.some(r=>r.id===m.id)).map(m=>m.id);
      const history:Message[]=[];
      for(let i=0;i<ids.length;i+=100){const r=await db().from("messages").select("*").eq("conversation_id",conversationId).in("id",ids.slice(i,i+100));if(r.error)throw r.error;history.push(...r.data as Message[]);}
      if(!alive.current)return;
      setMessages(previous=>{
        let next=merge(previous.filter(m=>!!m.status),[...history,...latest]);
        for(const [id,event] of events.current)if(event.revision>start)next=event.row?merge(next,[event.row]):next.filter(m=>m.id!==id);
        rows.current=next;return next;
      });
      setMore(latest.length===30||history.length>0);setError("");lastSync.current=Date.now();
    }catch(e){if(alive.current)setError(errorText(e));}
    finally{refreshing.current=false;if(alive.current)setLoading(false);}
  },[conversationId]);
  useEffect(()=>{
    alive.current=true;rows.current=[];events.current.clear();revision.current=0;setMessages([]);setLoading(true);setConnected(false);
    const hydrate=(async()=>{
      const [saved,queue]=await Promise.all([cached<Message[]>(userId,"messages:"+conversationId),pending(userId)]);
      if(!alive.current)return;
      let next=merge(saved??[],queue.filter(q=>q.message.conversation_id===conversationId).map(q=>({...q.message,status:q.failed?"failed" as const:"queued" as const})));
      for(const [id,event] of events.current)next=event.row?merge(next,[event.row]):next.filter(m=>m.id!==id);
      rows.current=next;setMessages(next);if(next.length||!navigator.onLine)setLoading(false);
    })();
    const receive=(row:Message)=>{
      if(!alive.current||row.conversation_id!==conversationId)return;
      events.current.set(row.id,{row,revision:++revision.current});
      setMessages(previous=>{const next=merge(previous,[row]);rows.current=next;return next;});
      if(row.user_id===userId&&!row.status)void acknowledge(userId,row.id);
    };
    const remove=(id:string)=>{
      if(!alive.current)return;
      events.current.set(id,{row:null,revision:++revision.current});
      setMessages(previous=>{const next=previous.filter(m=>m.id!==id);rows.current=next;return next;});
    };
    const client=db();
    const channel=client.channel("messages:"+conversationId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}})
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq."+conversationId},event=>receive(event.new as Message))
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages",filter:"conversation_id=eq."+conversationId},event=>receive(event.new as Message))
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"messages"},event=>remove(String(event.old.id)))
      .subscribe(status=>{if(!alive.current)return;setConnected(status==="SUBSCRIBED");if(status==="SUBSCRIBED")void hydrate.then(()=>{if(alive.current)void reconcile();});});
    const fallback=setTimeout(()=>{void hydrate.then(()=>{if(alive.current&&Date.now()-lastSync.current>1000)void reconcile();});},1500);
    const outbox=(event:Event)=>{const d=(event as CustomEvent<{userId:string;row?:Message;removed?:string}>).detail;if(d.userId===userId){if(d.row)receive(d.row);if(d.removed)remove(d.removed);}};
    const focus=()=>{if(document.visibilityState==="visible"&&Date.now()-lastSync.current>10000)void hydrate.then(()=>{if(alive.current)void reconcile();});};
    window.addEventListener("bitchat-outbox",outbox);window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);
    return()=>{alive.current=false;clearTimeout(fallback);void cache(userId,"messages:"+conversationId,cacheable(rows.current));void client.removeChannel(channel);window.removeEventListener("bitchat-outbox",outbox);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);};
  },[conversationId,userId,reconcile]);
  useEffect(()=>{const t=setTimeout(()=>void cache(userId,"messages:"+conversationId,cacheable(messages)),500);return()=>clearTimeout(t);},[messages,userId,conversationId]);
  const loadOlder=useCallback(async()=>{
    const first=rows.current.find(m=>!m.status);if(!first||paging.current||!navigator.onLine)return;
    paging.current=true;setOlder(true);const start=revision.current;
    try{
      const r=await db().from("messages").select("*").eq("conversation_id",conversationId).or("created_at.lt."+first.created_at+",and(created_at.eq."+first.created_at+",id.lt."+first.id+")").order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30);
      if(r.error)throw r.error;if(!alive.current)return;
      let fetched=r.data as Message[];for(const [id,event] of events.current)if(event.revision>start)fetched=event.row?fetched.map(m=>m.id===id?event.row!:m):fetched.filter(m=>m.id!==id);
      setMessages(previous=>{const next=merge(fetched,previous);rows.current=next;return next;});setMore(r.data.length===30);setError("");
    }catch(e){if(alive.current)setError(errorText(e));}finally{paging.current=false;if(alive.current)setOlder(false);}
  },[conversationId]);
  const send=useCallback(async(content:string,media_url:string|null=null,media_kind:Message["media_kind"]=null,kind:Message["kind"]="message",reply_to:string|null=null)=>{
    const message:Message={id:crypto.randomUUID(),conversation_id:conversationId,user_id:userId,content:content.trim(),media_url,media_kind,kind,reply_to,instant_viewed:false,created_at:new Date().toISOString()};
    try{await enqueue(message);}catch(e){if(!navigator.onLine)throw e;const r=await db().from("messages").insert({id:message.id,conversation_id:conversationId,user_id:userId,content:message.content,media_url,media_kind,kind,reply_to}).select("*").single();if(r.error)throw r.error;announce(userId,r.data as Message);}
  },[conversationId,userId]);
  const edit=useCallback(async(id:string,content:string)=>{
    const r=await db().from("messages").update({content:content.trim()}).eq("id",id).eq("user_id",userId).select("*").single();if(r.error)throw r.error;
    announce(userId,r.data as Message);
  },[userId]);
  const remove=useCallback(async(id:string)=>{
    const r=await db().from("messages").delete().eq("id",id).eq("user_id",userId).select("id");if(r.error)throw r.error;if(!r.data.length)throw new Error("This action is unavailable.");announce(userId,undefined,id);
  },[userId]);
  return{messages,loading,more,older,connected,error,loadOlder,reconcile,send,edit,remove,retry:enqueue};
}
