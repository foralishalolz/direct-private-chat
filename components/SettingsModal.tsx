
"use client";
import {useState,type FormEvent} from "react";
import {ArrowRight} from "lucide-react";
import {rpc} from "@/lib/supabase";
import {errorText} from "@/lib/types";
import {Modal,Spinner} from "./UI";
export default function SettingsModal({onClose,onSuccess}:{onClose:()=>void;onSuccess:()=>void}){
 const [code,setCode]=useState(""),[busy,setBusy]=useState(false),[invalid,setInvalid]=useState("");
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);try{if(!await rpc<boolean>("unlock_pro",{p_code:code}))throw new Error("Invalid PIN");onSuccess();onClose();}catch(e){setInvalid(errorText(e));}finally{setBusy(false);}}
 return <Modal onClose={onClose}><form className="secret-form" onSubmit={submit}><input autoComplete="off" aria-label="PIN" aria-invalid={!!invalid} title={invalid} type="password" inputMode="numeric" value={code} maxLength={64} onChange={e=>{setCode(e.target.value);setInvalid("");}} required/><button className="primary" aria-label="Submit" disabled={busy}>{busy?<Spinner/>:<ArrowRight size={22}/>}</button></form></Modal>;
}
