"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {db} from "@/lib/supabase";
import {acknowledge,announce,cache,cached,cacheable,enqueue,pending,clearConversation,visibleRows} from "@/lib/offline";
import {errorText,historyIds,merge,type Message} from "@/lib/types";
export function useMessages(conversationId:string,userId:string){
  const [messages,setMessages]=useState<Message[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(true),[older,setOlder]=useState(false),[connected,setConnected]=useState(false),[error,setError]=useState("");
  const rows=useRef<Message[]>([]),events=useRef(new Map<string,{row:Message|null;revision:number}>()),revision=useRef(0),alive=useRef(false),refreshing=useRef(false),refreshAgain=useRef(false),paging=useRef(false),lastSync=useRef(0);
  const viewed=useRef(new Set<string>());
  const personalize=useCallback(async(input:Message[])=>{
    const ids=input.filter(m=>m.kind==="instant"&&m.per_recipient&&m.user_id!==userId).map(m=>m.id);
    for(let i=0;i<ids.length;i+=100){const r=await db().from("instant_receipts").select("message_id").eq("user_id",userId).in("message_id",ids.slice(i,i+100));if(r.error)throw r.error;for(const receipt of r.data)viewed.current.add(receipt.message_id);}
    return input.map(m=>m.kind==="instant"&&m.per_recipient&&m.user_id!==userId?{...m,instant_viewed:viewed.current.has(m.id)}:m);
  },[userId]);
  useLayoutEffect(()=>{rows.current=messages;},[messages]);
  const reconcile=useCallback(async()=>{
    if(refreshing.current){refreshAgain.current=true;return;}if(!navigator.onLine)return;
    refreshing.current=true;const start=revision.current;
    try{
      const result=await db().from("messages").select("*").eq("conversation_id",conversationId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30);
      if(result.error)throw result.error;
      const latest=result.data as Message[];
      const ids=historyIds(rows.current,latest);
      const history:Message[]=[];
      for(let i=0;i<ids.length;i+=100){const r=await db().from("messages").select("*").eq("conversation_id",conversationId).in("id",ids.slice(i,i+100));if(r.error)throw r.error;history.push(...r.data as Message[]);}
      const confirmed=await personalize([...history,...latest]);
      if(!alive.current)return;
      setMessages(previous=>{
        let next=merge(visibleRows(userId,conversationId,previous.filter(m=>!!m.status)),visibleRows(userId,conversationId,confirmed));
        for(const [id,event] of events.current)if(event.revision>start)next=event.row?merge(next,[event.row]):next.filter(m=>m.id!==id);
        rows.current=next;return next;
      });
      setMore(latest.length===30||history.length>0);setError("");lastSync.current=Date.now();
    }catch(e){if(alive.current)setError(errorText(e));}
    finally{refreshing.current=false;if(alive.current){setLoading(false);if(refreshAgain.current){refreshAgain.current=false;void reconcile();}}}
  },[conversationId,userId,personalize]);
  useEffect(()=>{
    alive.current=true;rows.current=[];viewed.current.clear();events.current.clear();revision.current=0;setMessages([]);setLoading(true);setConnected(false);
    const hydrate=(async()=>{
      const [saved,queue]=await Promise.all([cached<Message[]>(userId,"messages:"+conversationId),pending(userId)]);
      if(!alive.current)return;
      let next=merge(visibleRows(userId,conversationId,saved??[]),queue.filter(q=>q.message.conversation_id===conversationId).map(q=>({...q.message,status:q.failed?"failed" as const:"queued" as const})));
      for(const [id,event] of events.current)next=event.row?merge(next,[event.row]):next.filter(m=>m.id!==id);
      rows.current=next;setMessages(next);if(next.length||!navigator.onLine)setLoading(false);
    })();
    const receive=(row:Message)=>{
      if(!alive.current||row.conversation_id!==conversationId||!visibleRows(userId,conversationId,[row]).length)return;
      if(row.kind==="instant"&&row.per_recipient&&row.user_id!==userId)row={...row,instant_viewed:viewed.current.has(row.id)};
      events.current.set(row.id,{row,revision:++revision.current});
      setMessages(previous=>{const next=merge(previous,[row]);rows.current=next;return next;});
      if(row.user_id===userId&&!row.status)void acknowledge(userId,row.id);
    };
    const remove=(id:string)=>{
      if(!alive.current||(!rows.current.some(m=>m.id===id)&&!refreshing.current&&!paging.current))return;
      events.current.set(id,{row:null,revision:++revision.current});
      setMessages(previous=>{const next=previous.filter(m=>m.id!==id);rows.current=next;return next;});
    };
    const client=db();
    const channel=client.channel("messages:"+conversationId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}})
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq."+conversationId},event=>receive(event.new as Message))
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages",filter:"conversation_id=eq."+conversationId},event=>receive(event.new as Message))
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"messages"},event=>remove(String(event.old.id)))
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"instant_receipts",filter:"user_id=eq."+userId},event=>{const id=String(event.new.message_id);viewed.current.add(id);const m=rows.current.find(m=>m.id===id);if(m)receive({...m,instant_viewed:true});})
      .on("postgres_changes",{event:"*",schema:"public",table:"chat_preferences",filter:"conversation_id=eq."+conversationId},event=>{const pref=event.new as {user_id?:string;cleared_before?:string};if(pref.user_id===userId&&pref.cleared_before)void clearConversation(userId,conversationId,pref.cleared_before);})
      .subscribe(status=>{if(!alive.current)return;setConnected(status==="SUBSCRIBED");if(status==="SUBSCRIBED")void hydrate.then(()=>{if(alive.current)void reconcile();});});
    // The HTTP snapshot starts immediately after local hydration, in parallel with Realtime.
    void hydrate.then(()=>{if(alive.current)void reconcile();});
    const clear=(event:Event)=>{const d=(event as CustomEvent<{userId:string;conversationId:string}>).detail;if(d.userId===userId&&d.conversationId===conversationId){events.current.clear();revision.current++;setMessages(previous=>{const next=visibleRows(userId,conversationId,previous);rows.current=next;return next;});setMore(false);}};
    window.addEventListener("bitchat-chat-cleared",clear);
    const outbox=(event:Event)=>{const d=(event as CustomEvent<{userId:string;row?:Message;removed?:string}>).detail;if(d.userId===userId){if(d.row)receive(d.row);if(d.removed)remove(d.removed);}};
    const focus=()=>{if(document.visibilityState==="visible"&&Date.now()-lastSync.current>10000)void hydrate.then(()=>{if(alive.current)void reconcile();});};
    window.addEventListener("bitchat-outbox",outbox);window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);
    return()=>{alive.current=false;window.removeEventListener("bitchat-chat-cleared",clear);void cache(userId,"messages:"+conversationId,cacheable(rows.current));void client.removeChannel(channel);window.removeEventListener("bitchat-outbox",outbox);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);};
  },[conversationId,userId,reconcile]);
  useEffect(()=>{const t=setTimeout(()=>void cache(userId,"messages:"+conversationId,cacheable(messages)),500);return()=>clearTimeout(t);},[messages,userId,conversationId]);
  const loadOlder=useCallback(async()=>{
    const first=rows.current.find(m=>!m.status);if(!first||paging.current||!navigator.onLine)return;
    paging.current=true;setOlder(true);const start=revision.current;
    try{
      const r=await db().from("messages").select("*").eq("conversation_id",conversationId).or("created_at.lt."+first.created_at+",and(created_at.eq."+first.created_at+",id.lt."+first.id+")").order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30);
      if(r.error)throw r.error;if(!alive.current)return;
      let fetched=await personalize(r.data as Message[]);if(!alive.current)return;for(const [id,event] of events.current)if(event.revision>start)fetched=event.row?fetched.map(m=>m.id===id?event.row!:m):fetched.filter(m=>m.id!==id);
      setMessages(previous=>{const next=merge(visibleRows(userId,conversationId,fetched),previous);rows.current=next;return next;});setMore(r.data.length===30);setError("");
    }catch(e){if(alive.current)setError(errorText(e));}finally{paging.current=false;if(alive.current)setOlder(false);}
  },[conversationId,userId,personalize]);
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
