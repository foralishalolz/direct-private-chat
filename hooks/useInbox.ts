
"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {cache,cached} from "@/lib/offline";
import {applyInboxMessage,applyInboxRead} from "@/lib/inbox";
import {errorText,type Message,type Conversation} from "@/lib/types";
export function useInbox(userId:string,onMessage?:(message:Partial<Message>)=>void){
 const notify=useRef(onMessage);notify.current=onMessage;
 const [items,setItems]=useState<Conversation[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState("");
 const alive=useRef(true),flight=useRef(false),queued=useRef(false),last=useRef<Conversation|undefined>(undefined),total=useRef(60);
 const latest=useRef<Conversation[]>([]),archiveRevision=useRef(0),archiveOverrides=useRef(new Map<string,{value:boolean;revision:number}>()),archiveLocks=useRef(new Set<string>());
 const messageRevision=useRef(0),previews=useRef(new Map<string,{row:Message;revision:number}>()),readMarkers=useRef(new Map<string,string>());
 const commit=useCallback((rows:Conversation[])=>{latest.current=rows;setItems(rows);},[]);
 useEffect(()=>{const timer=setTimeout(()=>void cache(userId,"inbox",items),600);return()=>clearTimeout(timer);},[userId,items]);
 const normalize=useCallback((rows:Conversation[],revision=archiveRevision.current)=>rows.map(c=>{
 const override=archiveOverrides.current.get(c.id);if(override&&override.revision<=revision)archiveOverrides.current.delete(c.id);
 return{...c,archived:override&&override.revision>revision?override.value:!!c.archived,partner:c.kind==="direct"?c.members?.find(p=>p.id!==userId):undefined,unread:!!c.preview&&(!c.read_at||c.read_at<c.last_activity)};
 }),[userId]);
 const refresh=useCallback(async()=>{
 if(flight.current){queued.current=true;return;}flight.current=true;const revision=archiveRevision.current,previewRevision=messageRevision.current;
 try{const all:Conversation[]=[];let cursor:Conversation|undefined;
 do{const rows=await rpc<Conversation[]>("inbox_page",cursor?{p_before:cursor.last_activity,p_before_id:cursor.id}:{});all.push(...rows);cursor=rows.at(-1);if(rows.length<60)break;}while(all.length<total.current);
 if(alive.current){let rows:Conversation[]=normalize(all,revision);for(const [id,event] of previews.current){if(event.revision>previewRevision||event.row.status)rows=applyInboxMessage(rows,event.row,userId);else previews.current.delete(id);}for(const [id,stamp] of readMarkers.current)rows=applyInboxRead(rows,id,stamp);commit(rows);last.current=rows.at(-1);setMore(all.length>=total.current);setError("");}}
 catch(e){if(alive.current)setError(errorText(e));}finally{flight.current=false;if(alive.current){setLoading(false);if(queued.current){queued.current=false;void refresh();}}}
 },[normalize,commit,userId]);
 useEffect(()=>{alive.current=true;let timer:ReturnType<typeof setTimeout>|undefined;let generation=0;
 void cached<Conversation[]>(userId,"inbox").then(rows=>{if(alive.current&&rows&&generation===0){latest.current=normalize(rows);setItems(latest.current);setLoading(false);}});
 let lastRealtimeRefresh=0;
 const update=(immediate=false)=>{if(timer!==undefined&&!immediate)return;clearTimeout(timer);const delay=immediate?350:Math.max(350,2500-(Date.now()-lastRealtimeRefresh));timer=setTimeout(()=>{timer=undefined;generation++;lastRealtimeRefresh=Date.now();void refresh();},delay);};
 const c=db(),ch=c.channel("inbox:"+userId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}});
 for(const table of ["conversations","conversation_members","profiles"])ch.on("postgres_changes",{event:"*",schema:"public",table},()=>update());
 ch.on("postgres_changes",{event:"*",schema:"public",table:"chat_preferences",filter:"user_id=eq."+userId},()=>update(true));
 const preview=(row:Message)=>{if(latest.current.some(c=>c.id===row.conversation_id)){const current=previews.current.get(row.conversation_id);if(current&&current.row.id!==row.id&&current.row.created_at>row.created_at)return;generation++;previews.current.set(row.conversation_id,{row,revision:++messageRevision.current});commit(applyInboxMessage(latest.current,row,userId));}};
 ch.on("postgres_changes",{event:"*",schema:"public",table:"messages"},event=>{if(event.eventType==="INSERT"){const row=event.new as Message;notify.current?.(row);preview(row);}update();});
 ch.subscribe(status=>{if(status==="SUBSCRIBED")update();});
 const local=(event:Event)=>{const d=(event as CustomEvent<{userId:string;row?:Message}>).detail;if(d.userId===userId&&d.row)preview(d.row);};
 const read=(event:Event)=>{const d=(event as CustomEvent<{userId:string;conversationId:string;stamp:string}>).detail;if(d.userId===userId){if((readMarkers.current.get(d.conversationId)??"")<d.stamp)readMarkers.current.set(d.conversationId,d.stamp);commit(applyInboxRead(latest.current,d.conversationId,d.stamp));}};
 update(true);const focus=()=>{if(document.visibilityState==="visible")update(true);};window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);window.addEventListener("bitchat-outbox",local);window.addEventListener("bitchat-inbox-read",read);
 return()=>{alive.current=false;clearTimeout(timer);void cache(userId,"inbox",latest.current);void c.removeChannel(ch);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);window.removeEventListener("bitchat-outbox",local);window.removeEventListener("bitchat-inbox-read",read);};},[refresh,normalize,userId,commit]);
 const setArchived=useCallback(async(id:string,archived:boolean)=>{
 if(archiveLocks.current.has(id))return;archiveLocks.current.add(id);
 try{await rpc<boolean>("set_chat_archived",{p_conversation:id,p_archived:archived});
 if(alive.current){archiveOverrides.current.set(id,{value:archived,revision:++archiveRevision.current});commit(latest.current.map(c=>c.id===id?{...c,archived}:c));void refresh();}}
 finally{archiveLocks.current.delete(id);}
 },[commit,refresh]);
 async function loadMore(){total.current+=60;await refresh();}
 return{items,loading,more,error,refresh,loadMore,setArchived};
}
