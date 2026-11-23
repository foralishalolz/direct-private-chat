"use client";
import {useEffect} from "react";

/**
 * Mirrors the unread conversation count onto the installed app icon,
 * the way a native app does. Clears when the tab is visible or the
 * count is zero. No-op where the platform does not support badging.
 */
export function useAppBadge(count:number){
 useEffect(()=>{
  const badge=typeof navigator==="undefined"?undefined:(navigator as Navigator&{setAppBadge?:(n?:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>});
  if(!badge||!(badge.setAppBadge||badge.clearAppBadge))return;
  const value=Number.isFinite(count)?Math.max(0,Math.floor(count)):0;
  const sync=async()=>{
   try{
    if(document.visibilityState==="visible"){await badge.clearAppBadge?.();return;}
    if(value>0&&badge.setAppBadge)await badge.setAppBadge(value);
    else await badge.clearAppBadge?.();
   }catch{}
  };
  void sync();
  const onVisibility=()=>void sync();
  document.addEventListener("visibilitychange",onVisibility);
  return()=>document.removeEventListener("visibilitychange",onVisibility);
 },[count]);
}
