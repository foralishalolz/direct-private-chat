"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {RealtimeChannel} from "@supabase/supabase-js";
import {db,rpc} from "@/lib/supabase";
import {usePrivacy} from "./usePrivacy";
type Activity={user_id:string;online:boolean;last_active:string|null};
const roomClosures=new Map<string,Promise<unknown>>();
export function activeLabel(value:string|null|undefined,now=Date.now()){
 if(!value)return "";const elapsed=Math.max(0,now-new Date(value).getTime());if(!Number.isFinite(elapsed))return "";
 if(elapsed<60000)return "Active just now";
 if(elapsed<3600000)return "Active "+Math.floor(elapsed/60000)+"m ago";
 if(elapsed<86400000)return "Active "+Math.floor(elapsed/3600000)+"h ago";
 return "Active "+Math.floor(elapsed/86400000)+"d ago";
}
export function usePresence(conversationId:string,userId:string){
 const {settings,ready}=usePrivacy();
 const [activity,setActivity]=useState<Activity[]>([]),[typing,setTyping]=useState<string[]>([]),[connected,setConnected]=useState(false);
 const last=useRef(0),expires=useRef(new Map<string,number>());
 const clearTyping=useCallback((id:string)=>{if(expires.current.delete(id))setTyping([...expires.current.keys()]);},[]);
 useEffect(()=>{
  setConnected(false);setActivity([]);setTyping([]);expires.current.clear();if(!ready)return;
  let alive=true,flight=false,again=false;const client=db();
  const refresh=async()=>{if(!alive||!navigator.onLine||document.visibilityState!=="visible")return;if(flight){again=true;return;}flight=true;
   try{const rows=await rpc<Activity[]>("member_activity",{p_conversation:conversationId});if(alive)setActivity(rows);}
   catch{}finally{flight=false;if(again&&alive){again=false;void refresh();}}
  };
  let scheduled:ReturnType<typeof setTimeout>;
  const schedule=()=>{clearTimeout(scheduled);scheduled=setTimeout(()=>void refresh(),250);};
  const shareOnline=ready&&settings.share_online;
  const topic="room:"+conversationId;let channel:RealtimeChannel|undefined;
  // Supabase reuses topic instances. Wait for the previous instance to leave.
  const starting=(roomClosures.get(topic)??Promise.resolve()).then(()=>{
   if(!alive)return;channel=client.channel(topic,{config:{private:true,presence:{key:userId}}});
   channel.on("presence",{event:"sync"},schedule).on("broadcast",{event:"typing"},({payload})=>{
    if(alive&&typeof payload?.id==="string"&&payload.id!==userId){expires.current.set(payload.id,Date.now()+4500);setTyping([...expires.current.keys()]);}
   }).subscribe(status=>{if(!alive)return;setConnected(status==="SUBSCRIBED");if(status==="SUBSCRIBED"){if(shareOnline&&document.visibilityState==="visible")void channel?.track({id:userId});schedule();}});
  }).catch(()=>{if(alive)setConnected(false);});
  const visibility=()=>{if(shareOnline&&document.visibilityState==="visible")void channel?.track({id:userId});else void channel?.untrack();schedule();};
  const timer=setInterval(()=>{if(!alive)return;let changed=false;for(const [id,until] of expires.current)if(until<Date.now()){expires.current.delete(id);changed=true;}if(changed)setTyping([...expires.current.keys()]);},1000);
  const poll=setInterval(()=>void refresh(),30000);void refresh();
  document.addEventListener("visibilitychange",visibility);window.addEventListener("online",visibility);
  return()=>{alive=false;clearInterval(timer);clearInterval(poll);clearTimeout(scheduled);expires.current.clear();document.removeEventListener("visibilitychange",visibility);window.removeEventListener("online",visibility);
   const closing=starting.then(()=>channel?client.removeChannel(channel):undefined).catch(()=>{});roomClosures.set(topic,closing);void closing.then(()=>{if(roomClosures.get(topic)===closing)roomClosures.delete(topic);});
  };
 },[conversationId,userId,ready,settings.share_online]);
 function sendTyping(){if(!ready||!settings.share_typing||Date.now()-last.current<1800||!navigator.onLine||document.visibilityState!=="visible")return;last.current=Date.now();void rpc("send_typing",{p_conversation:conversationId}).catch(()=>{});}
 return{online:activity.filter(p=>p.online).map(p=>p.user_id),lastActive:activity.find(p=>p.user_id!==userId)?.last_active??null,typing,sendTyping,clearTyping,connected};
}
