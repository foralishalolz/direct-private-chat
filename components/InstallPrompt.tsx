"use client";
import {useEffect,useState} from "react";
import {Download,Share} from "lucide-react";
import {Modal} from "./UI";

interface BeforeInstallPromptEvent extends Event{
 prompt():Promise<void>;
 userChoice:Promise<{outcome:"accepted"|"dismissed";platform:string}>;
}
/** Installation is offered only when requested from Profile, never over an active chat. */
export default function InstallPrompt(){
 const [prompt,setPrompt]=useState<BeforeInstallPromptEvent|null>(null),[open,setOpen]=useState(false),[ios,setIos]=useState(false),[standalone,setStandalone]=useState(false);
 useEffect(()=>{
  setIos(/iPhone|iPod/.test(navigator.userAgent||"")||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1));
  setStandalone(!!window.matchMedia?.("(display-mode: standalone)").matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
  const onPrompt=(event:Event)=>{event.preventDefault();setPrompt(event as BeforeInstallPromptEvent);};
  const onInstalled=()=>{setOpen(false);setPrompt(null);setStandalone(true);};
  const onRequest=()=>setOpen(true);
  window.addEventListener("beforeinstallprompt",onPrompt);window.addEventListener("appinstalled",onInstalled);window.addEventListener("bitchat-install",onRequest);
  return()=>{window.removeEventListener("beforeinstallprompt",onPrompt);window.removeEventListener("appinstalled",onInstalled);window.removeEventListener("bitchat-install",onRequest);};
 },[]);
 async function install(){const event=prompt;setOpen(false);setPrompt(null);if(event)try{await event.prompt();}catch{}}
 if(!open)return null;
 return <Modal title="Install BitchAt" onClose={()=>setOpen(false)}><div className="panel-pad install-content">
  {standalone?<p className="install-line">BitchAt is already open from your home screen.</p>:prompt?<><p className="install-line">Add BitchAt to your home screen for quick access.</p><button className="primary push" onClick={()=>void install()}><Download size={20}/>Install app</button></>:ios?<p className="install-manual">In Safari, tap <Share size={15} aria-hidden="true"/> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>:<p className="install-manual">Use your browser’s menu to install or add this page to your home screen, if supported.</p>}
 </div></Modal>;
}
