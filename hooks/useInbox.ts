
"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {cache,cached} from "@/lib/offline";
import {errorText,type Conversation} from "@/lib/types";
export function useInbox(userId:string){
 const [items,setItems]=useState<Conversation[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState("");
 const alive=useRef(true),flight=useRef(false),queued=useRef(false),last=useRef<Conversation|undefined>(undefined),total=useRef(60);
 const normalize=useCallback((rows:Conversation[])=>rows.map(c=>({...c,partner:c.kind==="direct"?c.members?.find(p=>p.id!==userId):undefined,unread:!!c.preview&&(!c.read_at||c.read_at<c.last_activity)})),[userId]);
 const refresh=useCallback(async()=>{
 if(flight.current){queued.current=true;return;}flight.current=true;
 try{const all:Conversation[]=[];let cursor:Conversation|undefined;
 do{const rows=await rpc<Conversation[]>("inbox_page",cursor?{p_before:cursor.last_activity,p_before_id:cursor.id}:{});all.push(...rows);cursor=rows.at(-1);if(rows.length<60)break;}while(all.length<total.current);
 if(alive.current){const rows=normalize(all);setItems(rows);last.current=rows.at(-1);setMore(all.length>=total.current);setError("");void cache(userId,"inbox",rows);}}
 catch(e){if(alive.current)setError(errorText(e));}finally{flight.current=false;if(alive.current){setLoading(false);if(queued.current){queued.current=false;void refresh();}}}
 },[normalize,userId]);
 useEffect(()=>{alive.current=true;let timer:ReturnType<typeof setTimeout>;let generation=0;
 void cached<Conversation[]>(userId,"inbox").then(rows=>{if(alive.current&&rows&&generation===0){setItems(rows);setLoading(false);}});
 const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{generation++;void refresh();},350);};
 const c=db(),ch=c.channel("inbox:"+userId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}});
 for(const table of ["conversations","conversation_members","profiles","chat_preferences"])ch.on("postgres_changes",{event:"*",schema:"public",table},update);
 ch.on("postgres_changes",{event:"*",schema:"public",table:"messages"},update);
 ch.subscribe(status=>{if(status==="SUBSCRIBED")update();});
 update();const focus=()=>{if(document.visibilityState==="visible")update();};window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);
 return()=>{alive.current=false;clearTimeout(timer);void c.removeChannel(ch);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);};},[refresh,userId]);
 async function loadMore(){total.current+=60;await refresh();}
 return{items,loading,more,error,refresh,loadMore};
}
