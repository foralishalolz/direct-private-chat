
"use client";
import {useEffect,useState} from "react";
import {ArrowUp,Trash2,ChevronDown} from "lucide-react";
import {db} from "@/lib/supabase";
import {cache,cached} from "@/lib/offline";
import {MOODS,day,errorText,type Journal} from "@/lib/types";
import {Modal,ErrorNote,IconButton,Spinner} from "./UI";
export default function JournalModal({userId,onClose}:{userId:string;onClose:()=>void}){
 const [rows,setRows]=useState<Journal[]>([]),[body,setBody]=useState(""),[mood,setMood]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[more,setMore]=useState(false);
 useEffect(()=>{let active=true;void cached<Journal[]>(userId,"journal").then(x=>{if(active&&x)setRows(x);});
 void db().from("journals").select("id,body,mood,created_at").eq("user_id",userId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30).then(r=>{if(!active)return;if(r.error)setError(errorText(r.error));else{setRows(r.data);setMore(r.data.length===30);void cache(userId,"journal",r.data);}});return()=>{active=false;};},[userId]);
 async function send(){if(!body.trim()||busy)return;setBusy(true);try{const r=await db().from("journals").insert({user_id:userId,body:body.trim(),mood}).select("id,body,mood,created_at").single();if(r.error)throw r.error;setRows(s=>[r.data,...s]);setBody("");setError("");void cache(userId,"journal",[r.data,...rows].slice(0,30));}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function older(){const last=rows.at(-1);if(!last)return;setBusy(true);try{const r=await db().from("journals").select("id,body,mood,created_at").eq("user_id",userId).or("created_at.lt."+last.created_at+",and(created_at.eq."+last.created_at+",id.lt."+last.id+")").order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30);if(r.error)throw r.error;setRows(s=>[...s,...r.data]);setMore(r.data.length===30);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <Modal title="Journal" wide onClose={onClose}><div className="panel-pad"><textarea aria-label="Journal entry" placeholder="…" maxLength={10000} rows={4} value={body} onChange={e=>setBody(e.target.value)}/><div className="row"><div className="emoji-row grow">{MOODS.map(x=><button key={x} aria-label={x} className={mood===x?"selected":""} onClick={()=>setMood(x)}>{x}</button>)}</div><button className="primary" aria-label="Save entry" disabled={busy||!body.trim()} onClick={()=>void send()}>{busy?<Spinner/>:<ArrowUp size={20}/>}</button></div><ErrorNote text={error}/><div className="journal-list">{rows.map(j=><article key={j.id}><div className="row"><span>{j.mood}</span><small>{day(j.created_at)}</small><IconButton label="Delete entry" className="push" onClick={async()=>{const r=await db().from("journals").delete().eq("id",j.id).eq("user_id",userId);if(r.error)setError(errorText(r.error));else{const next=rows.filter(x=>x.id!==j.id);setRows(next);void cache(userId,"journal",next.slice(0,30));}}}><Trash2 size={15}/></IconButton></div><p>{j.body}</p></article>)}</div>{more&&<IconButton label="Older entries" disabled={busy} onClick={()=>void older()}><ChevronDown/></IconButton>}</div></Modal>;
}
