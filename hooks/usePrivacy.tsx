"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {db,rpc} from "@/lib/supabase";
import {errorText} from "@/lib/types";
export type PrivacySettings={share_online:boolean;share_last_active:boolean;share_typing:boolean;share_receipts:boolean};
const defaults:PrivacySettings={share_online:true,share_last_active:true,share_typing:true,share_receipts:true};
type Context={settings:PrivacySettings;ready:boolean;busy:boolean;error:string;refresh:()=>Promise<void>;update:(patch:Partial<PrivacySettings>)=>Promise<void>};
const PrivacyContext=createContext<Context|null>(null);
function settingsFrom(value:unknown):PrivacySettings{
 const row=value&&typeof value==="object"?value as Record<string,unknown>:{};
 return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,typeof row[key]==="boolean"?row[key]:fallback])) as PrivacySettings;
}
export function PrivacyProvider({userId,children}:{userId:string;children:ReactNode}){
 const [settings,setSettings]=useState(defaults),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const alive=useRef(false),lock=useRef(false),epoch=useRef(0),current=useRef(settings),session=useRef(crypto.randomUUID()),activityQueue=useRef<Promise<void>>(Promise.resolve());current.current=settings;
 const refresh=useCallback(async()=>{const n=epoch.current;try{const result=await rpc("my_privacy");if(alive.current&&n===epoch.current){setSettings(settingsFrom(result));setReady(true);setError("");}}catch(e){if(alive.current)setError(errorText(e));}},[]);
 useEffect(()=>{alive.current=true;const client=db();void refresh();
  const channel=client.channel("privacy:"+userId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}}).on("postgres_changes",{event:"*",schema:"public",table:"privacy_settings",filter:"user_id=eq."+userId},event=>{if(alive.current&&"user_id" in event.new){epoch.current++;setSettings(settingsFrom(event.new));setReady(true);}}).subscribe();
  const online=()=>void refresh();window.addEventListener("online",online);
  return()=>{alive.current=false;epoch.current++;window.removeEventListener("online",online);void client.removeChannel(channel);};
 },[refresh,userId]);
 const update=useCallback(async(patch:Partial<PrivacySettings>)=>{
  if(lock.current)return;lock.current=true;epoch.current++;setBusy(true);setError("");const next={...current.current,...patch};
  try{const value=await rpc("set_privacy",{p_online:next.share_online,p_last_active:next.share_last_active,p_typing:next.share_typing,p_receipts:next.share_receipts});if(alive.current){setSettings(settingsFrom(value));setReady(true);}}
  catch(e){if(alive.current)setError(errorText(e));}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 },[]);
 useEffect(()=>{
  if(!ready)return;
  const enabled=settings.share_online||settings.share_last_active;
  const touch=(active:boolean)=>{activityQueue.current=activityQueue.current.then(async()=>{if(navigator.onLine)await rpc("touch_activity",{p_session:session.current,p_active:active});}).catch(()=>{});};
  const heartbeat=()=>touch(enabled&&document.visibilityState==="visible");
  heartbeat();const timer=setInterval(()=>{if(enabled&&document.visibilityState==="visible")heartbeat();},30000);
  const hide=()=>touch(false);document.addEventListener("visibilitychange",heartbeat);window.addEventListener("online",heartbeat);window.addEventListener("pagehide",hide);
  return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",heartbeat);window.removeEventListener("online",heartbeat);window.removeEventListener("pagehide",hide);touch(false);};
 },[userId,ready,settings.share_online,settings.share_last_active]);
 const context=useMemo(()=>({settings,ready,busy,error,refresh,update}),[settings,ready,busy,error,refresh,update]);
 return <PrivacyContext.Provider value={context}>{children}</PrivacyContext.Provider>;
}
export function usePrivacy(){const context=useContext(PrivacyContext);if(!context)throw new Error("Privacy context is missing.");return context;}
