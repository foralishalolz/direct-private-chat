"use client";
import {useEffect,useRef,useState} from "react";
import {ChevronDown,ChevronUp,ExternalLink,Link2,Play,Plus,Trash2} from "lucide-react";
import {db,rpc} from "@/lib/supabase";
import {normalizeReelUrl,reelEmbedUrl} from "@/lib/reels";
import {useLive} from "@/hooks/useLive";
import {errorText,type Conversation,type Profile} from "@/lib/types";
import {ErrorNote,Modal,Spinner} from "./UI";
type Reel={id:string;url:string;added_by:string;created_at:string};
export default function ReelViewer({c,p,onClose,initialUrl=""}:{c:Conversation;p:Profile;onClose:()=>void;initialUrl?:string}){
 const [selected,setSelected]=useState<string|null>(null),[opened,setOpened]=useState<string|null>(null),[add,setAdd]=useState(!!initialUrl),[url,setUrl]=useState(initialUrl),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const start=useRef<number|null>(null);
 const live=useLive<Reel[]>("reels:"+c.id,["couple_reels"],async()=>{const r=await db().from("couple_reels").select("id,url,added_by,created_at").eq("conversation_id",c.id).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(100);if(r.error)throw r.error;return r.data as Reel[];},[]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==="visible")void live.refresh();},10000);return()=>clearInterval(timer);},[live.refresh]);
 useEffect(()=>{if(!live.loading&&!live.data.some(r=>r.id===selected)){setSelected(live.data[0]?.id??null);setOpened(null);}},[live.data,live.loading,selected]);
 const index=live.data.findIndex(r=>r.id===selected),item=live.data[index];
 function navigate(n:number){const next=live.data[index+n];if(!next)return;setSelected(next.id);setOpened(null);}
 async function submit(){if(busy)return;setBusy(true);setError("");try{const normalized=normalizeReelUrl(url);const r=await rpc<Reel>("add_couple_reel",{p_conversation:c.id,p_url:normalized});live.setData(current=>[r,...current.filter(row=>row.id!==r.id)]);setUrl("");setAdd(false);setSelected(r.id);setOpened(null);await live.refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function remove(){if(!item||busy||!window.confirm("Remove this link for both of you?"))return;setBusy(true);setError("");try{await rpc("remove_couple_reel",{p_id:item.id});live.setData(current=>current.filter(row=>row.id!==item.id));setSelected(null);setOpened(null);await live.refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <Modal title="Shared sites & reels" onClose={onClose} full><div className="reel-viewer">
  <div className="reel-toolbar"><span>{item?`${index+1} / ${live.data.length}`:"Shared sites & reels"}</span>{p.is_pro&&<button className="reel-add-toggle" aria-expanded={add} onClick={()=>{setAdd(!add);setError("");}}><Plus size={17}/> Add link</button>}</div>
  {add&&p.is_pro&&<form className="reel-form" onSubmit={e=>{e.preventDefault();void submit();}}><label htmlFor="reel-url">Paste a site, video or Instagram reel link</label><div><input id="reel-url" type="url" autoComplete="url" inputMode="url" maxLength={2048} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…" required/><button className="primary" disabled={busy||!url.trim()}>{busy?<Spinner/>:"Add"}</button></div></form>}
  <ErrorNote text={error||live.error}/>
  <div className="reel-stage">
   {live.loading?<Spinner/>:!item?<div className="reel-placeholder"><Link2 size={32}/><strong>No links yet</strong><small>{p.is_pro?"Add a link to start":"A Pro partner can add links"}</small></div>:opened===item.id?<iframe key={item.id} className="reel-frame" title={"Embedded content from "+new URL(item.url).hostname} src={reelEmbedUrl(item.url)} sandbox="allow-scripts allow-forms allow-presentation" referrerPolicy="no-referrer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen/>:<div className="reel-placeholder"><span className="reel-domain">{new URL(item.url).hostname}</span><button className="reel-play" onClick={()=>setOpened(item.id)} aria-label="Load embedded site"><Play fill="currentColor" size={26}/></button><strong>Open embed</strong><small>Pop-ups are blocked. Only open sites you trust.</small></div>}
   {item&&<div className="reel-nav" onTouchStart={e=>{start.current=e.touches[0]?.clientY??null;}} onTouchEnd={e=>{if(start.current===null)return;const delta=e.changedTouches[0].clientY-start.current;start.current=null;if(Math.abs(delta)>45)navigate(delta<0?1:-1);}}><button aria-label="Previous reel" disabled={index<=0} onClick={()=>navigate(-1)}><ChevronUp size={23}/></button><span className="reel-swipe">Swipe</span><button aria-label="Next reel" disabled={index>=live.data.length-1} onClick={()=>navigate(1)}><ChevronDown size={23}/></button></div>}
  </div>
  {item&&<div className="reel-bottom"><div><strong>{new URL(item.url).hostname}</strong><small>Sites may block embeds or show ads.</small></div><a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open site in new tab"><ExternalLink size={19}/></a><button disabled={busy} aria-label="Remove reel" onClick={()=>void remove()}><Trash2 size={19}/></button></div>}
 </div></Modal>;
}
