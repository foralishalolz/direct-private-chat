
"use client";
import {useState,type FormEvent} from "react";
import {ArrowRight,Eye,EyeOff,AtSign,LockKeyhole} from "lucide-react";
import {db,endpoint} from "@/lib/supabase";
import {usernameEmail,errorText} from "@/lib/types";
import {Brand,ErrorNote,IconButton,Spinner} from "./UI";
export default function AuthScreen(){
 const [mode,setMode]=useState<"login"|"register">("login"),[username,setUsername]=useState(""),[password,setPassword]=useState(""),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");try{const email=usernameEmail(username);if(mode==="register"){const r=await endpoint("register",{username:email.split("@")[0],password},false);await r.json();}
 const r=await db().auth.signInWithPassword({email,password});if(r.error)throw r.error;
 }catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <main className="auth-screen"><div className="auth-orbit" aria-hidden="true"><div/><div/><div/></div><section className="auth-card"><Brand/><form onSubmit={submit} className="auth-form"><div className="auth-tabs" role="tablist" aria-label="Account"><button type="button" role="tab" aria-selected={mode==="login"} onClick={()=>{setMode("login");setError("");}}>Log in</button><button type="button" role="tab" aria-selected={mode==="register"} onClick={()=>{setMode("register");setError("");}}>Create account</button></div><label className="input-icon"><AtSign size={18}/><input aria-label="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Username" required minLength={3} maxLength={25} value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="input-icon"><LockKeyhole size={18}/><input aria-label="Password" autoComplete={mode==="login"?"current-password":"new-password"} type={show?"text":"password"} placeholder="Password" required minLength={mode==="register"?10:1} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/><IconButton label={show?"Hide password":"Show password"} onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</IconButton></label><ErrorNote text={error}/><button className="primary auth-submit" disabled={busy} aria-label={mode==="login"?"Log in":"Create account"}>{busy?<Spinner/>:<ArrowRight size={23}/>}</button></form></section><span className="auth-bottom" aria-hidden="true"><span/><span/><span/></span></main>;
}
