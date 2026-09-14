
"use client";
import {useEffect,useRef,useState,type ReactNode,type ButtonHTMLAttributes} from "react";
import {ArrowLeft,LoaderCircle,X,Users,MessageCircle} from "lucide-react";
import {signed} from "@/lib/media";
import {label,type Profile} from "@/lib/types";
export function IconButton({label:aria,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;children:ReactNode}){
 return <button type="button" aria-label={aria} title={aria} {...props} className={"icon-button "+(props.className??"")}>{children}</button>;
}
export function Spinner(){return <LoaderCircle className="spin" size={20} aria-label="Loading" role="status"/>;}
export function Brand({small=false}:{small?:boolean}){return <span className={"brand "+(small?"small":"")}><span className="brand-mark"><MessageCircle size={small?19:27} strokeWidth={2.5}/><i/></span><span>BitchAt<span className="brand-dot">.</span></span></span>;}
export function Avatar({profile,size=44,group=false}:{profile?:Partial<Profile>;size?:number;group?:boolean}){
 const [url,setUrl]=useState("");useEffect(()=>{let active=true;setUrl("");if(profile?.avatar_url)void signed("avatars",profile.avatar_url).then(x=>{if(active)setUrl(x);}).catch(()=>{});return()=>{active=false;};},[profile?.avatar_url,profile?.id]);
 return <span className="avatar" style={{width:size,height:size,fontSize:Math.round(size*.38)}}>{url?<img src={url} alt="" width={size} height={size} loading="lazy" onError={()=>setUrl("")}/>:group?<Users size={size*.45}/>:label(profile).slice(0,1).toUpperCase()||<MessageCircle size={size*.4}/>}</span>;
}
export function Modal({children,onClose,title,wide=false}:{children:ReactNode;onClose:()=>void;title?:string;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const first=ref.current?.querySelector<HTMLElement>("input,textarea,button,select,[tabindex='0']");first?.focus();
 const listener=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();close.current();}if(e.key==="Tab"){
 const els=[...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex='0']")??[])].filter(x=>x.offsetParent!==null);
 const a=els[0],z=els.at(-1);if(!a){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===a||document.activeElement===ref.current)){e.preventDefault();z?.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus();}}};
 document.addEventListener("keydown",listener);return()=>{document.removeEventListener("keydown",listener);previous?.focus();};},[]);
 return <div className="modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className={"modal "+(wide?"wide":"")} ref={ref} role="dialog" aria-modal="true" aria-label={title??"Settings"} tabIndex={-1}>{title&&<header className="modal-header"><h2>{title}</h2><IconButton label="Close" onClick={onClose}><X size={20}/></IconButton></header>}{children}</div></div>;
}
export function ErrorNote({text}:{text:string}){return text?<p className="error" role="alert">{text}</p>:null;}
export function Back({onClick}:{onClick:()=>void}){return <IconButton label="Back" onClick={onClick}><ArrowLeft size={22}/></IconButton>;}
