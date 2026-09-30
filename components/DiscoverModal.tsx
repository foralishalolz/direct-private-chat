"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowRight,Search,Users,Check,Link2} from "lucide-react";
import {rpc} from "@/lib/supabase";
import {errorText,label,type Profile} from "@/lib/types";
import {Avatar,Modal,ErrorNote,Spinner} from "./UI";

export default function DiscoverModal({userId,onOpen,onClose,initialMode="direct"}:{initialMode?:"direct"|"group"|"join";userId:string;onOpen:(id:string)=>void;onClose:()=>void}){
 const [query,setQuery]=useState(""),[results,setResults]=useState<Profile[]>([]),[selected,setSelected]=useState<Profile[]>([]);
 const [mode,setMode]=useState<"direct"|"group"|"join">(initialMode),[name,setName]=useState(""),[code,setCode]=useState("");
 const [busy,setBusy]=useState(false),[searching,setSearching]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{
  const n=++generation.current;setResults([]);
  if(mode==="join"||query.trim().replace(/^@/,"").length<3){setSearching(false);return;}
  setSearching(true);
  const timer=setTimeout(()=>{void rpc<Profile[]>("find_profiles",{p_query:query.trim().replace(/^@/,"")}).then(rows=>{if(n===generation.current)setResults(rows.filter(p=>p.id!==userId));}).catch(e=>{if(n===generation.current)setError(errorText(e));}).finally(()=>{if(n===generation.current)setSearching(false);});},250);
  return()=>{clearTimeout(timer);generation.current++;};
 },[query,userId,mode]);
 async function open(person?:Profile){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");
  try{
   const id=mode==="join"?await rpc<string>("join_group",{p_code:code.trim().toLowerCase()}):mode==="group"?await rpc<string>("create_group",{p_title:name.trim(),p_members:selected.map(p=>p.id)}):await rpc<string>("open_conversation",{p_other:person!.id});
   onOpen(id);onClose();
  }catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}
 }
 return <Modal title="New message" onClose={onClose}><div className="panel-pad">
  <div className="discover-modes"><button className={mode==="direct"?"active":""} onClick={()=>setMode("direct")}>People</button><button aria-label="New group" className={mode==="group"?"active":""} onClick={()=>setMode("group")}><Users size={16}/>New group</button><button className={mode==="join"?"active":""} onClick={()=>setMode("join")}><Link2 size={16}/>Join group</button></div>
  {mode==="join"?<form className="join-form" onSubmit={e=>{e.preventDefault();void open();}}><input autoCapitalize="none" autoComplete="off" spellCheck={false} aria-label="Invite code" placeholder="Invite code" value={code} maxLength={32} onChange={e=>{setCode(e.target.value.trim());setError("");}}/><button className="primary full spaced" disabled={busy||!/^[a-f0-9]{32}$/i.test(code)}>{busy?<Spinner/>:<>Join group<ArrowRight size={18}/></>}</button></form>:<>
   <label className="input-icon"><Search size={18}/><input autoCapitalize="none" autoComplete="off" aria-label="Search people" placeholder="@username or name" maxLength={100} value={query} onChange={e=>{setQuery(e.target.value);setError("");}}/></label>
   {mode==="group"&&<><input className="spaced" placeholder="Group name" aria-label="Group name" maxLength={60} value={name} onChange={e=>setName(e.target.value)}/><div className="chips">{selected.map(p=><button key={p.id} onClick={()=>setSelected(previous=>previous.filter(x=>x.id!==p.id))}>@{p.username} ×</button>)}</div></>}
   <div className="search-results">{searching?<Spinner/>:results.map(p=><button key={p.id} className="person-row" disabled={busy} onClick={()=>{if(mode==="group")setSelected(previous=>previous.some(x=>x.id===p.id)?previous.filter(x=>x.id!==p.id):previous.length<15?[...previous,p]:previous);else void open(p);}}><Avatar profile={p}/><span><strong>{label(p)}</strong><small>@{p.username}</small></span>{selected.some(x=>x.id===p.id)&&<Check size={18}/>}</button>)}{!searching&&query.trim().length>=3&&!results.length&&<p className="empty-label">No results</p>}</div>
   {mode==="group"&&<button className="primary full" aria-label="Create group" disabled={busy||selected.length<2||!name.trim()} onClick={()=>void open()}>{busy?<Spinner/>:<ArrowRight size={22}/>}</button>}
  </>}<ErrorNote text={error}/>
 </div></Modal>;
}
