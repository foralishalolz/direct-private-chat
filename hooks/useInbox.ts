
"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {cache,cached} from "@/lib/offline";
import {errorText,type Message,type Conversation} from "@/lib/types";
export function useInbox(userId:string,onMessage?:(message:Partial<Message>)=>void){
 const notify=useRef(onMessage);notify.current=onMessage;
 const [items,setItems]=useState<Conversation[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState("");
 const alive=useRef(true),flight=useRef(false),queued=useRef(false),last=useRef<Conversation|undefined>(undefined),total=useRef(60);
 const latest=useRef<Conversation[]>([]),archiveOverrides=useRef(new Map<string,boolean>()),archiveLocks=useRef(new Set<string>());
 const commit=useCallback((rows:Conversation[])=>{latest.current=rows;setItems(rows);void cache(userId,"inbox",rows);},[userId]);
 const normalize=useCallback((rows:Conversation[])=>rows.map(c=>{
 const override=archiveOverrides.current.get(c.id);if(override!==undefined&&!!c.archived===override)archiveOverrides.current.delete(c.id);
 return{...c,archived:override??!!c.archived,partner:c.kind==="direct"?c.members?.find(p=>p.id!==userId):undefined,unread:!!c.preview&&(!c.read_at||c.read_at<c.last_activity)};
 }),[userId]);
 const refresh=useCallback(async()=>{
 if(flight.current){queued.current=true;return;}flight.current=true;
 try{const all:Conversation[]=[];let cursor:Conversation|undefined;
 do{const rows=await rpc<Conversation[]>("inbox_page",cursor?{p_before:cursor.last_activity,p_before_id:cursor.id}:{});all.push(...rows);cursor=rows.at(-1);if(rows.length<60)break;}while(all.length<total.current);
 if(alive.current){const rows=normalize(all);commit(rows);last.current=rows.at(-1);setMore(all.length>=total.current);setError("");}}
 catch(e){if(alive.current)setError(errorText(e));}finally{flight.current=false;if(alive.current){setLoading(false);if(queued.current){queued.current=false;void refresh();}}}
 },[normalize,commit]);
 useEffect(()=>{alive.current=true;let timer:ReturnType<typeof setTimeout>;let generation=0;
 void cached<Conversation[]>(userId,"inbox").then(rows=>{if(alive.current&&rows&&generation===0){latest.current=normalize(rows);setItems(latest.current);setLoading(false);}});
 const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{generation++;void refresh();},350);};
 const c=db(),ch=c.channel("inbox:"+userId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}});
 for(const table of ["conversations","conversation_members","profiles"])ch.on("postgres_changes",{event:"*",schema:"public",table},update);
 ch.on("postgres_changes",{event:"*",schema:"public",table:"chat_preferences",filter:"user_id=eq."+userId},update);
 ch.on("postgres_changes",{event:"*",schema:"public",table:"messages"},event=>{if(event.eventType==="INSERT")notify.current?.(event.new as Partial<Message>);update();});
 ch.subscribe(status=>{if(status==="SUBSCRIBED")update();});
 update();const focus=()=>{if(document.visibilityState==="visible")update();};window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);
 return()=>{alive.current=false;clearTimeout(timer);void c.removeChannel(ch);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);};},[refresh,normalize,userId]);
 const setArchived=useCallback(async(id:string,archived:boolean)=>{
 if(archiveLocks.current.has(id))return;archiveLocks.current.add(id);
 try{await rpc<boolean>("set_chat_archived",{p_conversation:id,p_archived:archived});
 if(alive.current){archiveOverrides.current.set(id,archived);commit(latest.current.map(c=>c.id===id?{...c,archived}:c));void refresh();}}
 finally{archiveLocks.current.delete(id);}
 },[commit,refresh]);
 async function loadMore(){total.current+=60;await refresh();}
 return{items,loading,more,error,refresh,loadMore,setArchived};
}
