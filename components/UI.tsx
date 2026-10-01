
"use client";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode,type ButtonHTMLAttributes} from "react";
import {createPortal} from "react-dom";
import {ArrowLeft,LoaderCircle,X,Users,MessageCircle,Heart} from "lucide-react";
import {signed} from "@/lib/media";
import {label,type Profile} from "@/lib/types";
export function IconButton({label:aria,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;children:ReactNode}){
 return <button type="button" aria-label={aria} title={aria} {...props} className={"icon-button "+(props.className??"")}>{children}</button>;
}
export function Spinner(){return <LoaderCircle className="spin" size={20} aria-label="Loading" role="status"/>;}
export function Brand({small=false}:{small?:boolean}){return <span className={"brand "+(small?"small":"")}><span className="brand-mark"><MessageCircle size={small?21:30}/><Heart className="brand-heart" size={small?9:13} aria-hidden="true"/></span><span>BitchAt<span className="brand-dot">.</span></span></span>;}
export function Avatar({profile,size=44,group=false}:{profile?:Partial<Profile>;size?:number;group?:boolean}){
 const [url,setUrl]=useState("");useEffect(()=>{let active=true;setUrl("");if(profile?.avatar_url)void signed("avatars",profile.avatar_url).then(x=>{if(active)setUrl(x);}).catch(()=>{});return()=>{active=false;};},[profile?.avatar_url,profile?.id]);
 const colors=["#49436a","#325963","#685049","#4c596e","#655077"];const seed=(profile?.id||profile?.username||"group").split("").reduce((sum,char)=>sum+char.charCodeAt(0),0);
 return <span className="avatar" style={{width:size,height:size,fontSize:Math.round(size*.38),background:colors[seed%colors.length],color:"#f6f3ff"}}>{url?<img src={url} alt="" width={size} height={size} loading="lazy" onError={()=>setUrl("")}/>:group?<Users size={size*.45}/>:label(profile).slice(0,1).toUpperCase()||<MessageCircle size={size*.4}/>}</span>;
}
const modalRoots=new Set<HTMLElement>(),inertBefore=new Map<HTMLElement,boolean>();
function syncModals(){
 const top=[...modalRoots].at(-1);
 if(!top){for(const [element,value] of inertBefore)element.inert=value;inertBefore.clear();return;}
 for(const element of [...document.body.children])if(element instanceof HTMLElement){if(!inertBefore.has(element))inertBefore.set(element,element.inert);element.inert=element!==top;}
}
export function Modal({children,onClose,title,wide=false}:{children:ReactNode;onClose:()=>void;title?:string;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null),cover=useRef<HTMLDivElement>(null),close=useRef(onClose),drag=useRef<{id:number;y:number;offset:number;travel:number}|null>(null),suppressClick=useRef(0);
 close.current=onClose;
 useLayoutEffect(()=>{
  if(!cover.current)return;const root=cover.current,previous=document.activeElement as HTMLElement|null;modalRoots.add(root);syncModals();
  const first=[...(ref.current?.querySelectorAll<HTMLElement>("input,textarea,button,select,[tabindex='0']")??[])].find(node=>node.offsetParent!==null&&node.className!=="sheet-handle");(first??ref.current)?.focus({preventScroll:true});
  const listener=(event:KeyboardEvent)=>{
   if([...modalRoots].at(-1)!==root)return;
   if(event.key==="Escape"){event.preventDefault();close.current();}
   if(event.key==="Tab"){
    const nodes=[...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex='0']")??[])].filter(node=>node.offsetParent!==null);
    const first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return;}
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   }
  };
  document.addEventListener("keydown",listener);
  return()=>{document.removeEventListener("keydown",listener);modalRoots.delete(root);syncModals();if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 function end(cancelled=false){const offset=drag.current?.offset??0;if((drag.current?.travel??0)>8)suppressClick.current=Date.now()+350;drag.current=null;ref.current?.classList.remove("sheet-dragging");if(ref.current)ref.current.style.transform="";if(!cancelled&&offset>70)close.current();}
 if(typeof document==="undefined")return null;
 return createPortal(<div ref={cover} className="modal-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}><div className={"modal "+(wide?"wide":"")} ref={ref} role="dialog" aria-modal="true" aria-label={title??"Settings"} tabIndex={-1}>
  <button type="button" className="sheet-handle" aria-label="Dismiss sheet" onClick={event=>{if(Date.now()>=suppressClick.current)onClose();else event.preventDefault();}} onPointerDown={event=>{if(!event.isPrimary||event.button!==0)return;drag.current={id:event.pointerId,y:event.clientY,offset:0,travel:0};event.currentTarget.setPointerCapture(event.pointerId);ref.current?.classList.add("sheet-dragging");}} onPointerMove={event=>{if(!drag.current||drag.current.id!==event.pointerId)return;drag.current.travel=Math.max(drag.current.travel,Math.abs(event.clientY-drag.current.y));drag.current.offset=Math.max(0,Math.min(160,event.clientY-drag.current.y));if(ref.current)ref.current.style.transform=`translate3d(0,${drag.current.offset}px,0)`;}} onPointerUp={()=>end()} onPointerCancel={()=>end(true)} onLostPointerCapture={()=>{if(drag.current)end(true);}}><span/></button>
  {title&&<header className="modal-header"><h2>{title}</h2><IconButton label="Close" onClick={onClose}><X size={20}/></IconButton></header>}{children}
 </div></div>,document.body);
}
export function ErrorNote({text}:{text:string}){return text?<p className="error" role="alert">{text}</p>:null;}
export function Back({onClick}:{onClick:()=>void}){return <IconButton label="Back" onClick={onClick}><ArrowLeft size={22}/></IconButton>;}
