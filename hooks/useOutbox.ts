"use client";
import {useEffect} from "react";
import {db} from "@/lib/supabase";
import {acknowledge,announce,pending,updatePending,type Pending} from "@/lib/offline";
import type {Message} from "@/lib/types";
const running=new Set<string>();
export function useOutbox(userId:string|undefined){
  useEffect(()=>{
    if(!userId)return;
    let active=true;let timer:ReturnType<typeof setTimeout>;
    const run=async()=>{
      clearTimeout(timer);
      if(!active||!navigator.onLine||document.visibilityState==="hidden"||running.has(userId))return;
      const work=async()=>{
        if(running.has(userId))return;running.add(userId);
        try{
          const {data:{session}}=await db().auth.getSession();
          if(!session||session.user.id!==userId)return;
          const rows=await pending(userId);
          for(const row of rows){
            if(!active||!navigator.onLine)break;
            if(row.failed||row.nextAt>Date.now())continue;
            const {id,conversation_id,user_id,content,media_url,media_kind,kind,reply_to}=row.message;
            let {data,error}=await db().from("messages").insert({id,conversation_id,user_id,content,media_url,media_kind,kind,reply_to:reply_to??null}).select("*").single();
            if(error?.code==="23505"){const r=await db().from("messages").select("*").eq("id",id).eq("user_id",userId).maybeSingle();data=r.data;error=r.error??(r.data?null:error);}
            if(!error&&data){await acknowledge(userId,id);announce(userId,data as Message);continue;}
            if(error?.message?.includes("Message was removed")){await acknowledge(userId,id);announce(userId,undefined,id);continue;}
            const next:Pending={...row,attempts:row.attempts+1,nextAt:Date.now()+Math.min(60000,2000*2**Math.min(row.attempts,5)),failed:!!error&&/42501|23503|23514|P0001/.test(error.code??"")};
            await updatePending(next);
          }
        }finally{running.delete(userId);}
      };
      if(navigator.locks)await navigator.locks.request("bitchat-send:"+userId,{ifAvailable:true},async lock=>{if(lock)await work();});
      else await work();
      if(active&&(await pending(userId)).some(r=>!r.failed))timer=setTimeout(()=>void run(),5000);
    };
    const wake=()=>{void run();};
    window.addEventListener("online",wake);window.addEventListener("bitchat-outbox",wake);document.addEventListener("visibilitychange",wake);wake();
    return()=>{active=false;clearTimeout(timer);window.removeEventListener("online",wake);window.removeEventListener("bitchat-outbox",wake);document.removeEventListener("visibilitychange",wake);};
  },[userId]);
}
