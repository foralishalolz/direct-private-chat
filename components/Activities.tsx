
"use client";
import {useEffect,useRef,useState} from "react";
import dynamic from "next/dynamic";
import type {AffectionId} from "@/lib/affection";
import {ArrowUp,BarChart3,Check,ChevronDown,Flame,Heart,ImagePlus,LockKeyhole,Plus,Search,ShieldCheck,Trash2,UnlockKeyhole} from "lucide-react";
import {db,rpc} from "@/lib/supabase";
import {useLive} from "@/hooks/useLive";
import {haptic} from "@/lib/haptics";
import {imageFile,upload} from "@/lib/media";
import {day,errorText,label,time,type Capsule,type Conversation,type Game,type Message,type Poll,type Profile} from "@/lib/types";
import {Modal,IconButton,ErrorNote,Spinner} from "./UI";
import {ChatDetails,MessageHistory,QuickPlay} from "./ChatFeatures";
import {PrivateMedia} from "./MessageBubble";
import {SharedPet,FutureNames} from "./SharedWorld";
const CoupleMoment=dynamic(()=>import("./CoupleMoment"),{loading:()=> <div className="center pad"><Spinner/></div>});
const MakeoutSheet=dynamic(()=>import("./MakeoutSheet"),{loading:()=> <div className="center pad"><Spinner/></div>});
const MemoriesModal=dynamic(()=>import("./MemoriesModal"),{loading:()=> <div className="center pad"><Spinner/></div>});
export type ActivityTab="capsules"|"games"|"polls"|"stats"|"search"|"archive"|"chat"|"moment"|"makeout"|"memories"|"draw"|"feels"|"kiss"|"comfort"|"pet"|"arcade"|"arcade3d"|"listen";
const DrawBoard=dynamic(()=>import("./DrawBoard"),{loading:()=> <div className="center pad"><Spinner/></div>});
const FeelsSheet=dynamic(()=>import("./FeelsSheet"));
const ListenTogether=dynamic(()=>import("./ListenTogether"));
const LiveArcade=dynamic(()=>import("./LiveArcade"));
const Couple3DArcade=dynamic(()=>import("./Couple3DArcade"),{loading:()=> <div className="center pad"><Spinner/></div>});
export default function Activities({tab,conversation:c,profile:p,onClose,onRefresh,onExit,onAffection,onTab,onCall,onSend,onShared,onUploadAudio}:{tab:ActivityTab;conversation:Conversation;profile:Profile;onClose:()=>void;onRefresh:()=>Promise<void>;onExit:()=>void;onAffection:(id:AffectionId)=>Promise<void>;onTab?:(tab:ActivityTab)=>void;onCall?:(kind:"audio")=>void;onSend?:(line:string,kind?:"message"|"miss")=>Promise<void>;onShared?:(kind:"makeout"|"game"|"draw"|"wyr"|"kiss"|"pet")=>void;onUploadAudio?:(file:File)=>Promise<void>}){
 const titles:Record<ActivityTab,string>={capsules:"Capsules",games:"Play",polls:"Polls",stats:"Together",search:"Search messages",archive:"Message history",chat:"Chat",moment:"Us",makeout:"Makeout",memories:"Memories",draw:"Draw together",feels:"How are you?",kiss:"Kisses",comfort:"Comfort",pet:"Our pet",arcade:"Live games",arcade3d:"3D together",listen:"Listen together"};
 const couple=c.kind==="direct"&&c.couple_a&&c.couple_b;
 if(["moment","makeout","memories","pet","feels","kiss","comfort","stats"].includes(tab)&&!couple)return <Modal title="Couple mode" onClose={onClose}><div className="panel-pad"><p>Both people need to enable couple mode in chat details.</p></div></Modal>;
 if(tab==="draw")return <DrawBoard c={c} p={p} onClose={onClose}/>;
 if((tab==="feels"||tab==="kiss"||tab==="comfort")&&onSend)return <FeelsSheet c={c} tab={tab} onClose={onClose} onSend={onSend}/>;
 if(tab==="makeout")return <MakeoutSheet c={c} p={p} onClose={onClose}/>;
 if(tab==="memories")return <MemoriesModal c={c} p={p} onClose={onClose}/>;
 return <Modal title={titles[tab]} onClose={onClose} wide><div className={"panel-pad"+(tab==="moment"?" moment-panel":"")}>{tab==="listen"?<ListenTogether c={c} onUploadAudio={onUploadAudio}/>:tab==="arcade"?<LiveArcade c={c} p={p}/>:tab==="arcade3d"?<Couple3DArcade c={c} p={p}/>:tab==="pet"?<SharedPet c={c}/>:tab==="moment"?<CoupleMoment c={c} p={p} onAffection={onAffection} onTab={tab=>{onClose();onTab?.(tab);}}/>:tab==="capsules"?<Capsules c={c} p={p}/>:tab==="games"?<><div className="play-hero"><span aria-hidden="true">🎮</span><div><h3>Play together</h3></div></div>{c.kind==="direct"&&<button className="world-entry" onClick={()=>onTab?.("arcade")}><span>🕹️</span><span><strong>Live games</strong><small>Four in a row · Garden · Tap race</small></span><span>›</span></button>}{c.kind==="direct"&&<button className="world-entry" onClick={()=>onTab?.("arcade3d")}><span>🌌</span><span><strong>3D together</strong><small>Promise Orbits · Moonlit Garden · Starlight Rally</small></span><span>›</span></button>}{c.kind==="direct"&&<button className="world-entry" onClick={()=>onTab?.("listen")}><span>🎵</span><span><strong>Listen together</strong><small>Audio from your chat</small></span><span>›</span></button>}<QuickPlay c={c}/>{couple&&<><button className="world-entry" onClick={()=>onTab?.("pet")}><span>🐾</span><span><strong>Our pet</strong></span><span>›</span></button><FutureNames c={c}/></>}</>:tab==="polls"?<Polls c={c} p={p}/>:tab==="stats"?<Stats c={c} p={p}/>:tab==="archive"?<MessageHistory c={c}/>:tab==="search"?<MessageSearch c={c} archive={false}/>:<ChatDetails c={c} p={p} onRefresh={onRefresh} onExit={onExit} onCall={onCall}/>}</div></Modal>;
}
function Capsules({c,p}:{c:Conversation;p:Profile}){
 const [limit,setLimit]=useState(30),[body,setBody]=useState(""),[date,setDate]=useState(""),[photo,setPhoto]=useState<File|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[opened,setOpened]=useState<{content:string;media_url:string|null}|null>(null),[now,setNow]=useState(Date.now());const input=useRef<HTMLInputElement>(null),id=useRef(crypto.randomUUID());
 const live=useLive<Capsule[]>("capsules:"+c.id,["capsules"],async()=>{const r=await db().from("capsules").select("*").eq("conversation_id",c.id).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit);if(r.error)throw r.error;return r.data;},[]);
 useEffect(()=>{void live.refresh();},[limit,live.refresh]);useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
 async function send(){if(busy)return;setBusy(true);setError("");try{const unlock=new Date(date);if(!Number.isFinite(unlock.getTime())||unlock.getTime()<=Date.now())throw new Error("Choose a future date and time.");const path=photo?await upload(p.id,c.id,await imageFile(photo),"capsule-media"):null;
 await rpc("create_capsule",{p_id:id.current,p_conversation:c.id,p_content:body.trim(),p_media:path,p_unlock:unlock.toISOString()});id.current=crypto.randomUUID();setBody("");setDate("");setPhoto(null);await live.refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <><textarea placeholder="…" aria-label="Capsule message" maxLength={4000} rows={3} value={body} onChange={e=>setBody(e.target.value)}/><div className="row spaced"><input className="grow" type="datetime-local" aria-label="Unlock date and time" value={date} onChange={e=>setDate(e.target.value)}/><IconButton label="Add photo" className={photo?"selected":""} onClick={()=>input.current?.click()}><ImagePlus size={20}/></IconButton><button className="primary" disabled={busy||(!body.trim()&&!photo)||!date} aria-label="Seal capsule" onClick={()=>void send()}>{busy?<Spinner/>:<LockKeyhole size={20}/>}</button></div>{photo&&<button className="file-chip" onClick={()=>setPhoto(null)}>{photo.name} ×</button>}<input type="file" ref={input} hidden accept="image/jpeg,image/png,image/webp" onChange={e=>{setPhoto(e.target.files?.[0]??null);e.target.value="";}}/><ErrorNote text={error||live.error}/><div className="activity-list">{live.loading&&<Spinner/>}{live.data.map(item=><button className="capsule-card" disabled={busy||new Date(item.unlock_at).getTime()>now} key={item.id} onClick={async()=>{setBusy(true);try{const rows=await rpc<{content:string;media_url:string|null}[]>("open_capsule",{p_id:item.id});setOpened(rows[0]??null);}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>{new Date(item.unlock_at).getTime()>now?<LockKeyhole size={24}/>:<UnlockKeyhole size={24}/>}<span>{day(item.unlock_at)}<small>{time(item.unlock_at)}</small></span></button>)}</div>{live.data.length>=limit&&<IconButton label="Older capsules" onClick={()=>setLimit(x=>x+30)}><ChevronDown/></IconButton>}{opened&&<Modal title="Capsule" onClose={()=>setOpened(null)}><div className="panel-pad capsule-open">{opened.media_url&&<PrivateMedia bucket="capsule-media" path={opened.media_url}/>}<p className="message-text">{opened.content}</p></div></Modal>}</>;
}
const GAME_OPTIONS = [
 {type:"question", text:"Question", icon:"💭"}, {type:"truth", text:"Deep talk", icon:"🔮"},
 {type:"dare", text:"Dare", icon:"🎲"}, {type:"kiss_dare", text:"Kiss dare", icon:"💋"},
 {type:"finish", text:"Finish it", icon:"📝"}, {type:"would_you", text:"Would you rather", icon:"🤔"},
 {type:"either", text:"This or that", icon:"✨"}, {type:"tic_tac_toe", text:"Tic-tac-toe", icon:"⭕"},
 {type:"memory", text:"Our memories", icon:"📸", prompt:true}, {type:"future", text:"Future plans", icon:"🌱", prompt:true},
 {type:"guess", text:"Guess me", icon:"🎯", prompt:true}, {type:"emoji", text:"Emoji stories", icon:"🪄", prompt:true},
 {type:"spicy", text:"After dark · 18+", icon:"🌶️", prompt:true},
] as const;
function Games({c,p,onShared}:{c:Conversation;p:Profile;onShared?:()=>void}){
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[answer,setAnswer]=useState(""),[custom,setCustom]=useState("");
 const live=useLive<{game:Game|null;answers:{user_id:string;answer:string}[]}>("games:"+c.id,["games"],async()=>{const r=await db().from("games").select("*").eq("conversation_id",c.id).order("created_at",{ascending:false}).limit(1).maybeSingle();if(r.error)throw r.error;return{game:r.data as Game|null,answers:r.data?await rpc("game_answers",{p_id:r.data.id}):[]};},{game:null,answers:[]});
 const g=live.data.game,answered=live.data.answers.some(x=>x.user_id===p.id),active=!!g&&!g.ended_at;
 async function act(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError("");try{await fn();setAnswer("");await live.refresh();haptic("success");}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 function startGame(option:(typeof GAME_OPTIONS)[number]){void act(async()=>{if("prompt" in option) await rpc("start_prompt_game",{p_conversation:c.id,p_mode:option.type});else await rpc("start_game",{p_conversation:c.id,p_type:option.type,p_custom:(option.type==="question"||option.type==="truth"||option.type==="dare"||option.type==="finish")&&custom.trim()?custom.trim():null});onShared?.();});}
 return <>
  <ErrorNote text={error||live.error}/>
  {live.loading?<Spinner/>:g&&<section className="game-card" aria-label="Current game">
   <div className="game-card-top"><span>{g.ended_at?"ROUND COMPLETE":"PLAYING TOGETHER"}</span>{active&&<button className="end-game" disabled={busy} onClick={()=>{if(window.confirm("End this game for both of you?"))void act(()=>rpc("end_game",{p_id:g.id}));}}>End game</button>}</div>
   {g.game_type==="tic_tac_toe"?<><div className="game-status">{g.ended_at?g.winner?g.winner===p.id?"You won!":"Well played!":"Draw":g.next_player===p.id?"Your turn":"Their turn"}</div><div className="tic-board">{g.board.split("").map((cell,i)=><button aria-label={"Cell "+(i+1)+(cell!=="-"?", "+cell:"")} key={i} disabled={busy||!!g.ended_at||cell!=="-"||g.next_player!==p.id} onClick={()=>void act(()=>rpc("play_move",{p_id:g.id,p_cell:i}))}>{cell==="-"?"":cell}</button>)}</div></>:<>
    <h3>{g.question}</h3>
    {!answered&&!g.ended_at&&((g.game_type==="either"||g.game_type==="would_you"||g.game_type==="this_or_that")?<div className="either">{[g.option_a,g.option_b].map(x=><button key={x} disabled={busy} onClick={()=>void act(()=>rpc("answer_game",{p_id:g.id,p_answer:x}))}>{x}</button>)}</div>:<form onSubmit={e=>{e.preventDefault();void act(()=>rpc("answer_game",{p_id:g.id,p_answer:answer.trim()}));}}><textarea aria-label="Your answer" placeholder="Your answer…" maxLength={500} value={answer} onChange={e=>setAnswer(e.target.value)}/><button className="primary push spaced" disabled={busy||!answer.trim()} aria-label="Send answer"><ArrowUp size={20}/></button></form>)}
    <div className="answers">{live.data.answers.map(a=><div key={a.user_id}><small>{a.user_id===p.id?"You":label(c.partner)}</small><p>{a.answer}</p></div>)}</div>
    {answered&&!g.ended_at&&<p className="game-wait">Waiting for their answer…</p>}
   </>}
  </section>}
  <div className="play-section-title"><div><small>PLAY TOGETHER</small><h3>Choose your game</h3></div><button className="surprise-game" disabled={busy||live.loading||active} onClick={()=>{const safe=GAME_OPTIONS.filter(x=>!["spicy","dare","kiss_dare","finish"].includes(x.type));startGame(safe[Math.floor(Math.random()*safe.length)]);}}>✦ Surprise me</button></div>
  {active&&<p className="game-help">Finish or end the current game to start another.</p>}
  <div className="game-picker">{GAME_OPTIONS.map(option=><button key={option.type} disabled={busy||live.loading||active} onClick={()=>startGame(option)}><span aria-hidden="true">{option.icon}</span><strong>{option.text}</strong></button>)}</div>
  <p className="game-help">After dark is for consenting adults. Either of you can skip or end a round.</p>
  {p.is_pro&&!active&&<input className="spaced" placeholder="Your question" aria-label="Custom question" maxLength={250} value={custom} onChange={e=>setCustom(e.target.value)}/>}
 </>;
}
function Polls({c,p}:{c:Conversation;p:Profile}){
 const [question,setQuestion]=useState(""),[options,setOptions]=useState(["",""]),[busy,setBusy]=useState(false),[error,setError]=useState("");const id=useRef(crypto.randomUUID());
 const live=useLive<{polls:Poll[];votes:{poll_id:string;user_id:string;choice:number}[]}>("polls:"+c.id,["polls","poll_votes"],async()=>{const r=await db().from("polls").select("*").eq("conversation_id",c.id).order("created_at",{ascending:false}).limit(30);if(r.error)throw r.error;if(!r.data.length)return{polls:[],votes:[]};const v=await db().from("poll_votes").select("*").in("poll_id",r.data.map(x=>x.id));if(v.error)throw v.error;return{polls:r.data as Poll[],votes:v.data};},{polls:[],votes:[]});
 async function act(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError("");try{await fn();await live.refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <><input aria-label="Poll question" placeholder="Question" value={question} maxLength={200} onChange={e=>setQuestion(e.target.value)}/>{options.map((x,i)=><input key={i} className="spaced" aria-label={"Option "+(i+1)} placeholder={"Option "+(i+1)} value={x} maxLength={80} onChange={e=>setOptions(s=>s.map((v,j)=>i===j?e.target.value:v))}/>)}<div className="row spaced">{options.length<4&&<IconButton label="Add option" onClick={()=>setOptions(s=>[...s,""])}><Plus size={20}/></IconButton>}<button className="primary push" aria-label="Create poll" disabled={busy||!question.trim()||options.some(x=>!x.trim())} onClick={()=>void act(async()=>{await rpc("create_poll",{p_id:id.current,p_conversation:c.id,p_question:question.trim(),p_options:options.map(x=>x.trim())});id.current=crypto.randomUUID();setQuestion("");setOptions(["",""]);})}><ArrowUp size={20}/></button></div><ErrorNote text={error||live.error}/><div className="activity-list">{live.data.polls.map(poll=>{const votes=live.data.votes.filter(v=>v.poll_id===poll.id);return <article className="poll-card" key={poll.id}><h3>{poll.question}</h3>{poll.options.map((option,i)=>{const count=votes.filter(v=>v.choice===i).length,mine=votes.some(v=>v.user_id===p.id&&v.choice===i);return <button key={i} disabled={busy||Date.now()>new Date(poll.closes_at).getTime()} className={"poll-option "+(mine?"selected":"")} onClick={()=>void act(()=>rpc("vote_poll",{p_poll:poll.id,p_choice:i}))}><span className="poll-fill" style={{width:(votes.length?count/votes.length*100:0)+"%"}}/><span>{option}</span><span className="push">{mine&&<Check size={14}/>} {count}</span></button>;})}<small>{votes.length} votes</small></article>;})}</div></>;
}
function Stats({c,p}:{c:Conversation;p:Profile}){
 type S={streak:number;messages?:number;media?:number;misses?:number;mine?:number;goals?:number;games?:number;days?:{day:string;count:number}[];agreement?:number;shared_picks?:number};
 const live=useLive<S>("stats:"+c.id,["goals","games"],()=>rpc<S>("couple_stats",{p_conversation:c.id}),{streak:0});
 const s=live.data,max=Math.max(1,...(s.days??[]).map(x=>x.count));
 return <><ErrorNote text={live.error}/><div className="streak-card"><Flame size={35}/><strong>{s.streak}</strong><span>Day streak</span></div>{p.is_pro&&<><div className="stats-grid">{[["Messages",s.messages],["Media",s.media],["Miss you",s.misses],["Goals",s.goals],["Games",s.games],["Shared picks",s.shared_picks]].map(([name,n])=><div key={name}><strong>{n??0}</strong><small>{name}</small></div>)}</div><div className="activity-chart" role="img" aria-label="Messages per day over the last 30 days">{s.days?.map(d=><span key={d.day} title={d.day+": "+d.count+" messages"} style={{height:Math.max(2,d.count/max*100)+"%"}}/>)}</div><div className="row muted"><small>30 days</small><small className="push">{s.mine??0} from you</small></div></>}{live.loading&&<Spinner/>}</>;
}
function MessageSearch({c,archive}:{c:Conversation;archive:boolean}){
 type Hit=Message&{message_id?:string;deleted_at?:string;username?:string};
 const [query,setQuery]=useState(""),[rows,setRows]=useState<Hit[]>([]),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");const generation=useRef(0);
 async function run(append=false,n=generation.current){setBusy(true);try{const last=append?rows.at(-1):undefined;const result=await rpc<Hit[]>(archive?"deleted_history":"search_messages",{p_conversation:c.id,...(!archive?{p_query:query.trim()}:{}),p_before:last?(archive?last.deleted_at:last.created_at):null,p_before_id:last?(archive?last.message_id:last.id):null});if(n===generation.current){setRows(s=>append?[...s,...result]:result);setMore(result.length===30);setError("");}}catch(e){if(n===generation.current)setError(errorText(e));}finally{if(n===generation.current)setBusy(false);}}
 useEffect(()=>{const n=++generation.current;setRows([]);setMore(false);if(!archive&&query.trim().length<2){setBusy(false);return;}const timer=setTimeout(()=>void run(false,n),250);return()=>{clearTimeout(timer);generation.current++;};},[query,archive,c.id]);
 return <>{!archive&&<label className="input-icon"><Search size={18}/><input aria-label="Search messages" placeholder="Search" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/></label>}<ErrorNote text={error}/><div className="search-hits">{rows.map(m=><article key={m.message_id??m.id}><small>{m.username??label(c.members?.find(p=>p.id===m.user_id))} · {day(m.created_at)} {time(m.created_at)}</small><p>{m.content}</p></article>)}</div>{busy&&<Spinner/>}{more&&<IconButton label="More results" disabled={busy} onClick={()=>void run(true)}><ChevronDown size={20}/></IconButton>}</>;
}
type Goal={id:string;prompt:string;available_at:string;completed_a:string|null;completed_b:string|null};
export function GoalCard({c,p}:{c:Conversation;p:Profile}){
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const live=useLive<Goal|null>("goal:"+c.id,["goals"],()=>rpc<Goal>("ensure_goal",{p_conversation:c.id}),null);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==="visible")setNow(Date.now());},10000);return()=>clearInterval(timer);},[]);
 const g=live.data;if(!g||new Date(g.available_at).getTime()>now)return null;
 const done=c.member_a===p.id?g.completed_a:g.completed_b;
 return <aside className="goal-card"><span className="goal-icon"><Heart size={21}/></span><div><small>Together</small><p>{g.prompt}</p><div className="goal-checks"><span className={g.completed_a?"done":""}><Check size={12}/>{label(c.members?.find(x=>x.id===c.member_a))}</span><span className={g.completed_b?"done":""}><Check size={12}/>{label(c.members?.find(x=>x.id===c.member_b))}</span></div><ErrorNote text={error}/></div><IconButton label="Complete goal" disabled={!!done||busy} className={done?"completed":""} onClick={async()=>{setBusy(true);try{await rpc("complete_goal",{p_id:g.id});await live.refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}><Check size={20}/></IconButton></aside>;
}
