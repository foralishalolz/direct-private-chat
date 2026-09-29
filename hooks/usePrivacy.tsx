"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {db,rpc} from "@/lib/supabase";
import {errorText} from "@/lib/types";
import {DEFAULT_PRIVACY,reconcilePrivacy,type PrivacySettings,type PrivacySnapshot} from "@/lib/privacy";
export type {PrivacySettings} from "@/lib/privacy";
type Context={settings:PrivacySettings;ready:boolean;busy:boolean;error:string;refresh:()=>Promise<void>;update:(patch:Partial<PrivacySettings>)=>Promise<void>};
const PrivacyContext=createContext<Context|null>(null);
export function PrivacyProvider({userId,children}:{userId:string;children:ReactNode}){
 const [settings,setSettings]=useState(DEFAULT_PRIVACY),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const alive=useRef(false),lock=useRef(false),snapshot=useRef<PrivacySnapshot|null>(null),session=useRef(crypto.randomUUID()),activityQueue=useRef<Promise<void>>(Promise.resolve());
 const apply=useCallback((value:unknown)=>{const next=reconcilePrivacy(snapshot.current,value);if(!next)throw new Error("Could not load privacy settings.");if(next!==snapshot.current){snapshot.current=next;const {revision,...preferences}=next;void revision;setSettings(preferences);}setReady(true);},[]);
 const refresh=useCallback(async()=>{try{const result=await rpc("my_privacy");if(alive.current){apply(result);setError("");}}catch(e){if(alive.current)setError(errorText(e));}},[apply]);
 useEffect(()=>{alive.current=true;const client=db();void refresh();
  const channel=client.channel("privacy:"+userId+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}}).on("postgres_changes",{event:"*",schema:"public",table:"privacy_settings",filter:"user_id=eq."+userId},event=>{if(alive.current&&"user_id" in event.new){try{apply(event.new);}catch(e){setError(errorText(e));}}}).subscribe();
  const online=()=>void refresh();window.addEventListener("online",online);
  return()=>{alive.current=false;window.removeEventListener("online",online);void client.removeChannel(channel);};
 },[refresh,apply,userId]);
 const update=useCallback(async(patch:Partial<PrivacySettings>)=>{
  if(lock.current||!snapshot.current)return;lock.current=true;setBusy(true);setError("");
  try{for(const key of Object.keys(DEFAULT_PRIVACY) as (keyof PrivacySettings)[]){if(typeof patch[key]!=="boolean")continue;const value=await rpc("set_privacy_option",{p_setting:key,p_enabled:patch[key]});if(alive.current)apply(value);}}
  catch(e){if(alive.current)setError(errorText(e));}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 },[apply]);
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
