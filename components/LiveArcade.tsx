"use client";
import {useEffect,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {useLive} from "@/hooks/useLive";
import {countdownSeconds} from "@/lib/liveTiming";
import {haptic} from "@/lib/haptics";
import {errorText,label,type Conversation,type Profile} from "@/lib/types";
import {ErrorNote,Spinner} from "./UI";

type Mode="four"|"garden"|"race"|"grid";
type Round={round_id:string;mode:Mode;board:string;next_player:string|null;winner:string|null;finished:boolean;ready_a:boolean;ready_b:boolean;ready_at:string|null};
const modes:{id:Mode;name:string;icon:string;hint:string}[]=[{id:"four",name:"Four in a row",icon:"🔴",hint:"Take turns"},{id:"grid",name:"Starlines",icon:"✨",hint:"Four in a line"},{id:"garden",name:"Garden",icon:"🌱",hint:"Grow together"},{id:"race",name:"Tap race",icon:"⚡",hint:"First tap wins"}];
export default function LiveArcade({c,p}:{c:Conversation;p:Profile}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now());
 const live=useLive<Round|null>("arcade:"+c.id,["live_arcade"],async()=>{const r=await db().from("live_arcade").select("*").eq("conversation_id",c.id).maybeSingle();if(r.error)throw r.error;return r.data as Round|null;},null);
 useEffect(()=>{const poll=setInterval(()=>{if(document.visibilityState==="visible")void live.refresh();},3000);const timer=setInterval(()=>setNow(Date.now()),200);return()=>{clearInterval(poll);clearInterval(timer);};},[live.refresh]);
 async function act(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError("");try{await fn();await live.refresh();haptic("light");}catch(e){setError(errorText(e));await live.refresh();}finally{setBusy(false);}}
 const g=live.data,active=!!g&&!g.finished,mine=g?.next_player===p.id;
 const ready=p.id===c.member_a?g?.ready_a:g?.ready_b;
 const remaining=countdownSeconds(g?.ready_at??null,now);
 const move=(action:string,cell:number|null=null)=>{if(!g)return;void act(()=>rpc("play_live_arcade",{p_conversation:c.id,p_round:g.round_id,p_action:action,p_cell:cell}));};
 return <section className="live-arcade" aria-label="Live games">
  {live.loading?<div className="center pad"><Spinner/></div>:active&&g?<>
   <div className="arcade-head"><div><small>LIVE GAME</small><h3>{modes.find(x=>x.id===g.mode)?.name}</h3></div><button disabled={busy} onClick={()=>{if(window.confirm("End this game for both players?"))move("end");}}>End</button></div>
   {g.mode==="four"&&<><p className="arcade-status">{mine?"Your turn":`${label(c.partner)}’s turn`}</p><div className="four-board" aria-label="Four in a row">{Array.from({length:7},(_,col)=><button className="four-column" aria-label={"Drop in column "+(col+1)} key={col} disabled={busy||!mine||g.board[col]!=="-"} onClick={()=>move("move",col)}>{Array.from({length:6},(_,row)=>{const v=g.board[row*7+col];return <span className={v==="A"?"a":v==="B"?"b":""} key={row}/>;})}</button>)}</div></>}
   {g.mode==="grid"&&<><p className="arcade-status">{mine?"Your turn":`${label(c.partner)}’s turn`}</p><div className="starlines-board" aria-label="Starlines">{g.board.split("").map((v,i)=><button key={i} aria-label={v==="-"?"Place at spot "+(i+1):"Occupied spot "+(i+1)} disabled={busy||!mine||v!=="-"} onClick={()=>move("move",i)}>{v==="-"?"":v==="A"?"✦":"●"}</button>)}</div></>}
   {g.mode==="garden"&&<><p className="arcade-status">{mine?"Your turn to plant":`${label(c.partner)}’s turn to plant`}</p><div className="garden-board">{g.board.split("").map((v,i)=><button key={i} disabled={busy||!mine||v!=="-"} aria-label={v==="-"?"Plant in spot "+(i+1):"Planted spot "+(i+1)} onClick={()=>move("move",i)}>{v==="-"?"·":v==="A"?"🌷":"🌼"}</button>)}</div></>}
   {g.mode==="race"&&<div className="race-stage">{!g.ready_at?<><span>⚡</span><p>{ready?"Waiting for the other player":"Ready when you are"}</p><button className="primary" disabled={busy||ready} onClick={()=>move("ready")}>{ready?"Ready ✓":"Ready"}</button></>:<><strong className="race-count">{remaining||"GO!"}</strong><button className="race-tap" disabled={busy||remaining>0} onClick={()=>move("tap")}>TAP!</button><small>First tap received by the server wins.</small></>}</div>}
  </>:<>{g&&<div className="arcade-result">{g.mode==="garden"&&g.board.indexOf("-")===-1?"🌼 Garden complete!":g.winner?(g.winner===p.id?"✨ You won!":`✨ ${label(c.partner)} won!`):"Round ended"}</div>}<div className="arcade-picker">{modes.map(m=><button key={m.id} disabled={busy} onClick={()=>void act(()=>rpc("start_live_arcade",{p_conversation:c.id,p_mode:m.id}))}><span>{m.icon}</span><strong>{m.name}</strong><small>{m.hint}</small></button>)}</div></>}
  <ErrorNote text={error||live.error}/>
 </section>;
}
