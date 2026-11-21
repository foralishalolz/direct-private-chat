"use client";
import {useEffect,useRef,useState} from "react";
import {Download,Share,X} from "lucide-react";
import {Modal} from "./UI";

interface BeforeInstallPromptEvent extends Event{
 prompt():Promise<void>;
 userChoice:Promise<{outcome:"accepted"|"dismissed";platform:string}>;
}
const DISMISS="bitchat-install-dismissed";

/**
 * Offers the PWA install once, like a native app, and mirrors the
 * manual share-sheet instructions on iPhone where the install API
 * is unavailable. Dismisses persistently until the app is disconnected.
 */
export default function InstallPrompt(){
 const [prompt,setPrompt]=useState<BeforeInstallPromptEvent|null>(null);
 const [manual,setManual]=useState(false);
 const [open,setOpen]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);

 useEffect(()=>{
  if(typeof window==="undefined")return;
  let dismissed=false;
  try{dismissed=localStorage.getItem(DISMISS)==="true";}catch{}
  const standalone=window.matchMedia?.("(display-mode: standalone)").matches
    ||!!(window.navigator as Navigator&{standalone?:boolean}).standalone;
  if(dismissed||standalone)return;
  const onPrompt=(event:Event)=>{event.preventDefault();setPrompt(event as BeforeInstallPromptEvent);setOpen(true);};
  window.addEventListener("beforeinstallprompt",onPrompt);
  const onInstalled=()=>{setOpen(false);try{localStorage.setItem(DISMISS,"true");}catch{}};
  window.addEventListener("appinstalled",onInstalled);
  const iPhone=/iPhone|iPod/.test(navigator.userAgent||"");
  const iPad=navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1;
  if((iPhone||iPad)&&!standalone){
   setManual(true);
   timer.current=setTimeout(()=>setOpen(true),1600);
  }
  return()=>{window.removeEventListener("beforeinstallprompt",onPrompt);window.removeEventListener("appinstalled",onInstalled);if(timer.current)clearTimeout(timer.current);};
 },[]);

 function dismiss(){
  setOpen(false);setPrompt(null);setManual(false);
  try{localStorage.setItem(DISMISS,"true");}catch{}
 }

 async function install(){
  const event=prompt;setOpen(false);setPrompt(null);setManual(false);
  if(event){try{await event.prompt();}catch{}}
 }

 if(!open)return null;
 return <Modal title="Install BitchAt" onClose={dismiss}><div className="panel-pad install-content">
  <p className="install-line">BitchAt works like a native app on your home screen — even offline.</p>
  {prompt?<button className="primary push" onClick={()=>void install()}><Download size={20}/>Install app</button>:
   <p className="install-manual">On iPhone, tap <Share size={15} aria-hidden="true"/> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>}
  <button aria-label="Not now" className="quiet-button" onClick={dismiss}><X size={18}/></button>
 </div></Modal>;
}
