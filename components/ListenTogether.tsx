"use client";
import {useEffect,useRef,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {signed} from "@/lib/media";
import {useLive} from "@/hooks/useLive";
import {playbackPosition} from "@/lib/liveTiming";
import {errorText,type Conversation} from "@/lib/types";
import {ErrorNote,Spinner} from "./UI";
type AudioMessage={id:string;media_url:string;created_at:string;content:string};
type Session={message_id:string;playing:boolean;position:number;changed_at:string};
export default function ListenTogether({c}:{c:Conversation}){
 const [tracks,setTracks]=useState<AudioMessage[]>([]),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[joined,setJoined]=useState(false),[source,setSource]=useState(""),[blocked,setBlocked]=useState(false),[ended,setEnded]=useState(false);
 const audio=useRef<HTMLAudioElement>(null);
 const live=useLive<Session|null>("listening:"+c.id,["shared_listening"],async()=>{const r=await db().from("shared_listening").select("message_id,playing,position,changed_at").eq("conversation_id",c.id).maybeSingle();if(r.error)throw r.error;return r.data as Session|null;},null);
 const session=live.data;
 useEffect(()=>{let alive=true;void (async()=>{const r=await db().from("messages").select("id,media_url,created_at,content").eq("conversation_id",c.id).eq("media_kind","audio").not("media_url","is",null).gte("created_at",new Date(Date.now()-24*3600000).toISOString()).order("created_at",{ascending:false}).limit(30);if(r.error)throw r.error;if(alive)setTracks(r.data as AudioMessage[]);})().catch(e=>{if(alive)setError(errorText(e));});return()=>{alive=false;};},[c.id]);
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==="visible")void live.refresh();},3000);return()=>clearInterval(t);},[live.refresh]);
 useEffect(()=>{setJoined(false);setSource("");setBlocked(false);setEnded(false);},[session?.message_id]);
 function sync(){const a=audio.current;if(!a||!session||!joined)return;const target=playbackPosition(session.position,session.playing,session.changed_at);if(Number.isFinite(a.duration)&&target>=a.duration){a.pause();setEnded(true);return;}setEnded(false);if(Math.abs(a.currentTime-target)>1.5)try{a.currentTime=target;}catch{}if(session.playing)void a.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));else {a.pause();setBlocked(false);}}
 useEffect(()=>{sync();},[session?.changed_at,source,joined]);
 async function join(){if(!session)return;setBusy(true);setError("");try{const msg=tracks.find(x=>x.id===session.message_id);if(!msg)throw new Error("Audio is unavailable or expired in your chat.");setSource(await signed("chat-media",msg.media_url));setJoined(true);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function control(action:"start"|"play"|"pause",restart=false) {if(busy)return;const id=action==="start"?selected:session?.message_id;if(!id)return;setBusy(true);setError("");try{await rpc("control_listening",{p_conversation:c.id,p_action:action,p_message:id,p_position:action==="start"?null:restart?0:Math.min(86400,Math.max(0,audio.current?.currentTime??0))});await live.refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <section className="listen-panel"><div className="listen-art" aria-hidden="true">♫</div><h3>Listen together</h3><p>Choose an audio file shared in this chat. Both people tap Join to listen.</p><select aria-label="Choose audio" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose audio from chat</option>{tracks.map(t=><option key={t.id} value={t.id}>{t.content?.trim()||"Audio"} · {new Date(t.created_at).toLocaleString()}</option>)}</select><button className="quiet-button" disabled={!selected||busy} onClick={()=>void control("start")}>Share audio</button>{session&&<div className="listen-controls"><strong>{tracks.find(t=>t.id===session.message_id)?.content||"Shared audio"}</strong>{!joined?<button className="primary" disabled={busy} onClick={()=>void join()}>Join listening</button>:<><audio ref={audio} src={source} preload="metadata" playsInline onLoadedMetadata={sync} onEnded={()=>setEnded(true)} onError={()=>setError("Audio could not be played. It may have expired or this format may not be supported.")}/>{blocked&&<button className="quiet-button" onClick={()=>{void audio.current?.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));}}>Tap to enable audio</button>}<button className="primary" disabled={busy||blocked} onClick={()=>void control(ended?"play":session.playing?"pause":"play",ended)}>{ended?"Restart for both":session.playing?"Pause for both":"Play for both"}</button></>}</div>}<ErrorNote text={error||live.error}/>{live.loading&&<Spinner/>}</section>;
}
