"use client";
import {useEffect,useState} from "react";
import {db,rpc} from "@/lib/supabase";
import {useLive} from "@/hooks/useLive";
import {haptic} from "@/lib/haptics";
import {errorText,type Conversation} from "@/lib/types";
import {ErrorNote,Spinner} from "./UI";

type Pet={name:string;species:"cat"|"dog"|"bunny";feeds:number;plays:number;cuddles:number;last_action:string};
type Name={id:string;name:string};
const animals={cat:"🐱",dog:"🐶",bunny:"🐰"};
export function SharedPet({c}:{c:Conversation}){
 const [name,setName]=useState(""),[species,setSpecies]=useState<Pet["species"]>("cat"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[editing,setEditing]=useState(false);
 const live=useLive<Pet|null>("pet:"+c.id,["couple_pet"],async()=>{const r=await db().from("couple_pet").select("*").eq("conversation_id",c.id).maybeSingle();if(r.error)throw r.error;return r.data as Pet|null;},null);
 useEffect(()=>{const t=setInterval(()=>void live.refresh(),10000);return()=>clearInterval(t);},[live.refresh]);
 async function action(act:string){if(busy)return;setBusy(true);setError("");try{await rpc("care_couple_pet",{p_conversation:c.id,p_action:act,p_name:act==="adopt"||act==="rename"?name.trim():null,p_species:act==="adopt"?species:null});await live.refresh();setEditing(false);setName("");haptic("success");}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 const pet=live.data;
 return <section className="shared-world pet-world" aria-label="Our pet"><div className="world-heading"><div><small>YOUR SHARED PET</small><h3>{pet?pet.name:"Adopt a little friend"}</h3></div>{pet&&<button className="world-link" onClick={()=>{setName(pet.name);setEditing(!editing);}}>Rename</button>}</div>
 {live.loading?<Spinner/>:!pet?<><div className="pet-choices">{(Object.keys(animals) as Pet["species"][]).map(a=><button key={a} aria-label={a} aria-pressed={species===a} onClick={()=>setSpecies(a)}>{animals[a]}</button>)}</div><div className="world-form"><input aria-label="Pet name" maxLength={24} value={name} onChange={e=>setName(e.target.value)} placeholder="Give them a name"/><button className="primary" disabled={busy||!name.trim()} onClick={()=>void action("adopt")}>Adopt</button></div></>:<><div className="pet-scene" aria-label={pet.species}>{animals[pet.species]}</div><p className="pet-caption">{pet.last_action==="adopt"?"Your new friend is home.":pet.last_action==="rename"?"A new name for your little friend.":pet.last_action==="feed"?"That was tasty!":pet.last_action==="play"?"That was fun!":"Feeling loved."}</p>{editing&&<div className="world-form"><input aria-label="New pet name" maxLength={24} value={name} onChange={e=>setName(e.target.value)}/><button className="primary" disabled={busy||!name.trim()} onClick={()=>void action("rename")}>Save</button></div>}<div className="pet-actions">{([["feed","🥣","Feed",pet.feeds],["play","🧶","Play",pet.plays],["cuddle","💗","Cuddle",pet.cuddles]] as const).map(([a,icon,text,count])=><button key={a} disabled={busy} onClick={()=>void action(a)}><span>{icon}</span><strong>{text}</strong><small>{count}</small></button>)}</div></>}
 <ErrorNote text={error||live.error}/></section>;
}
export function FutureNames({c}:{c:Conversation}){
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const live=useLive<Name[]>("future-names:"+c.id,["future_names"],async()=>{const r=await db().from("future_names").select("id,name").eq("conversation_id",c.id).order("created_at");if(r.error)throw r.error;return r.data as Name[];},[]);
 useEffect(()=>{const t=setInterval(()=>void live.refresh(),10000);return()=>clearInterval(t);},[live.refresh]);
 async function change(remove?:string){if(busy)return;setBusy(true);setError("");try{await rpc("change_future_name",{p_conversation:c.id,p_name:remove?null:name.trim(),p_remove:remove??null});setName("");await live.refresh();haptic("light");}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <section className="shared-world future-world"><div className="world-heading"><div><small>DAYDREAM TOGETHER</small><h3>Names we love</h3></div><span aria-hidden="true">🌱</span></div><form className="world-form" onSubmit={e=>{e.preventDefault();void change();}}><input aria-label="Add a name" maxLength={40} placeholder="Add a name" value={name} onChange={e=>setName(e.target.value)}/><button className="primary" disabled={busy||!name.trim()}>Add</button></form><div className="name-list">{live.data.map(item=><span key={item.id}>{item.name}<button type="button" disabled={busy} aria-label={"Remove "+item.name} onClick={()=>void change(item.id)}>×</button></span>)}</div><ErrorNote text={error||live.error}/></section>;
}
