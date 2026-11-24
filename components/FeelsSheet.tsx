"use client";
import {useState} from "react";
import {errorText,type Conversation} from "@/lib/types";
import {ErrorNote,Modal} from "./UI";

export default function FeelsSheet({tab,onClose,onSend}:{c:Conversation;tab:"feels"|"kiss"|"comfort";onClose:()=>void;onSend:(line:string,kind?:"message"|"miss")=>Promise<void>}){
 const [draft,setDraft]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function send(){if(busy||!draft.trim())return;setBusy(true);setError("");try{await onSend(draft.trim());onClose();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <Modal title={tab==="kiss"?"Kiss":tab==="comfort"?"Comfort":"Feels"} onClose={onClose}><div className="panel-pad feels-draft"><div className="emoji-row">{["💋","🫂","🥺","😢","❤️","🫶"].map(emoji=><button key={emoji} aria-label={"Add "+emoji} onClick={()=>setDraft(s=>s+emoji)}>{emoji}</button>)}</div><textarea autoFocus aria-label="Your message" placeholder="Write your own message…" maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)}/><div className="feels-draft-actions"><button className="primary" disabled={busy||!draft.trim()} onClick={()=>void send()}>{busy?"Sending…":"Send"}</button></div><ErrorNote text={error}/></div></Modal>;
}
