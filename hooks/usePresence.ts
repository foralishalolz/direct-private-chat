
"use client";
import {useEffect,useRef,useState} from "react";
import type {RealtimeChannel} from "@supabase/supabase-js";
import {db} from "@/lib/supabase";
export function usePresence(conversationId:string,userId:string){
 const [online,setOnline]=useState<string[]>([]),[typing,setTyping]=useState<string[]>([]);
 const ref=useRef<RealtimeChannel|null>(null),last=useRef(0),expires=useRef(new Map<string,number>());
 useEffect(()=>{let active=true;const client=db();const ch=client.channel("room:"+conversationId,{config:{private:true,presence:{key:userId}}});ref.current=ch;
 const sync=()=>{if(active)setOnline(Object.keys(ch.presenceState()).filter(x=>x!==userId));};
 ch.on("presence",{event:"sync"},sync).on("broadcast",{event:"typing"},({payload})=>{if(active&&typeof payload?.id==="string"&&payload.id!==userId){expires.current.set(payload.id,Date.now()+4500);setTyping([...expires.current.keys()]);}}).subscribe(status=>{if(status==="SUBSCRIBED"&&document.visibilityState==="visible")void ch.track({id:userId});});
 const visibility=()=>{if(document.visibilityState==="visible")void ch.track({id:userId});else void ch.untrack();};
 const timer=setInterval(()=>{if(!active)return;let changed=false;for(const [id,at] of expires.current)if(at<Date.now()){expires.current.delete(id);changed=true;}if(changed)setTyping([...expires.current.keys()]);},1000);
 document.addEventListener("visibilitychange",visibility);return()=>{active=false;ref.current=null;clearInterval(timer);expires.current.clear();document.removeEventListener("visibilitychange",visibility);void client.removeChannel(ch);};},[conversationId,userId]);
 function sendTyping(){if(Date.now()-last.current<1800||document.visibilityState!=="visible")return;last.current=Date.now();void ref.current?.send({type:"broadcast",event:"typing",payload:{id:userId}});}
 return{online,typing,sendTyping};
}
