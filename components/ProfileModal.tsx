
"use client";
import {useRef,useState} from "react";
import {Bell,Camera,Check,ChevronDown,LogOut,Radio,Settings,ShieldCheck,EyeOff,Leaf} from "lucide-react";
import {setDataSaver} from "@/lib/device";
import {describeRelay,normalizeTurn,readTurn,testRelay,writeTurn} from "@/lib/turn";
import {db} from "@/lib/supabase";
import {imageFile,upload} from "@/lib/media";
import {MOODS,errorText,type Profile} from "@/lib/types";
import {Avatar,Modal,IconButton,ErrorNote,Spinner} from "./UI";
import NotificationsModal from "./NotificationsModal";
import PrivacyModal from "./PrivacyModal";
import SettingsModal from "./SettingsModal";
export default function ProfileModal({profile,onChange,onClose,onLogout}:{profile:Profile;onChange:(p:Profile)=>void;onClose:()=>void;onLogout:()=>Promise<void>}){
 const [name,setName]=useState(profile.display_name??""),[mood,setMood]=useState(profile.mood),[busy,setBusy]=useState(false),[error,setError]=useState(""),[secret,setSecret]=useState(false),[privacy,setPrivacy]=useState(false),[notifications,setNotifications]=useState(false);const file=useRef<HTMLInputElement>(null);
 const [saving,setSaving]=useState(()=>{try{return localStorage.getItem("bitchat-data-saver:"+profile.id)==="true";}catch{return false;}});
 const [relayOpen,setRelayOpen]=useState(false),[relayState,setRelayState]=useState(()=>{try{return describeRelay();}catch{return "Direct only";}}),[relayUrl,setRelayUrl]=useState(()=>{try{return readTurn()?.url??"";}catch{return "";}}),[relayUser,setRelayUser]=useState(()=>{try{return readTurn()?.username??"";}catch{return "";}}),[relayPass,setRelayPass]=useState(()=>{try{return readTurn()?.credential??"";}catch{return "";}}),[relayBusy,setRelayBusy]=useState(false),[relayResult,setRelayResult]=useState("");
 async function saveRelay(){
  setRelayBusy(true);setError("");
  try{
   // A bad address is reported before anything is stored, so a typo cannot
   // silently break calling on the next attempt.
   const config=relayUrl.trim()?normalizeTurn({url:relayUrl,username:relayUser,credential:relayPass}):null;
   const probe=config?(await testRelay(config)):null;
   if(probe&&!probe.ok){setRelayResult(probe.detail);setError(probe.detail);return;}
   writeTurn(config);
   setRelayState(describeRelay());
   setRelayResult(probe?probe.detail:"Relay removed. Calls connect directly only.");
  }catch(e){setError(errorText(e));setRelayResult("");}finally{setRelayBusy(false);}
 }
 async function save(patch:Partial<Profile>){setBusy(true);setError("");try{const r=await db().from("profiles").update(patch).eq("id",profile.id).select("id,username,display_name,avatar_url,mood,is_pro").single();if(r.error)throw r.error;onChange(r.data as Profile);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <Modal title="Profile" onClose={onClose}><div className="profile-edit"><button className="avatar-edit" aria-label="Change profile photo" disabled={busy} onClick={()=>file.current?.click()}><Avatar profile={profile} size={88}/><span><Camera size={16}/></span></button><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async e=>{const photo=e.target.files?.[0];e.target.value="";if(!photo)return;setBusy(true);try{const path=await upload(profile.id,null,await imageFile(photo,512),"avatars");await save({avatar_url:path});}catch(e){setError(errorText(e));}finally{setBusy(false);}}}/><p className="muted">@{profile.username} {profile.is_pro&&<ShieldCheck size={16}/>}</p><input aria-label="Display name" placeholder="Name" value={name} maxLength={40} onChange={e=>setName(e.target.value)}/><div className="emoji-row">{MOODS.map(x=><button className={x===mood?"selected":""} aria-label={x} aria-pressed={x===mood} key={x} onClick={()=>setMood(x===mood?null:x)}>{x}</button>)}</div><button className="device-setting" aria-label="Call relay" aria-expanded={relayOpen} onClick={()=>setRelayOpen(!relayOpen)}><Radio size={19}/><span>Call relay<small>{relayState}</small></span><ChevronDown size={16} className={relayOpen?"rot":""}/></button>{relayOpen&&<div className="relay-form"><p className="muted">Calls go straight between your phones. On mobile data a carrier NAT can block that, so add a TURN relay you control (for example a free coturn server). It is stored on this device only.</p><input aria-label="Relay address" placeholder="turn:relay.example.com:3478" value={relayUrl} maxLength={200} onChange={e=>setRelayUrl(e.target.value)}/><div className="row gap"><input aria-label="Relay username" placeholder="Username" value={relayUser} maxLength={200} onChange={e=>setRelayUser(e.target.value)}/><input aria-label="Relay password" type="password" placeholder="Password" value={relayPass} maxLength={200} onChange={e=>setRelayPass(e.target.value)}/></div><div className="row"><button className="device-setting" disabled={relayBusy} onClick={()=>void saveRelay()}>{relayBusy?<Spinner/>:<Check size={18}/>}<span>Save and test relay</span></button></div><span className="action-status" role="status">{relayResult}</span></div>}<button className="device-setting" role="switch" aria-label="Data saver" aria-checked={saving} onClick={()=>{try{setDataSaver(profile.id,!saving);setSaving(!saving);}catch(e){setError(errorText(e));}}}><Leaf size={19}/><span>Data saver</span><span className={"switch "+(saving?"on":"")} aria-hidden="true"/></button><ErrorNote text={error}/><div className="row"><IconButton label="Log out" onClick={()=>void onLogout()}><LogOut size={20}/></IconButton><IconButton label="Privacy" onClick={()=>setPrivacy(true)}><EyeOff size={21}/></IconButton><IconButton label="Notifications" onClick={()=>setNotifications(true)}><Bell size={20}/></IconButton><IconButton label="Settings" onClick={()=>setSecret(true)}><Settings size={20}/></IconButton><button className="primary push" disabled={busy} aria-label="Save profile" onClick={()=>void save({display_name:name.trim(),mood})}>{busy?<Spinner/>:<Check size={21}/>}</button></div></div>{notifications&&<NotificationsModal userId={profile.id} onClose={()=>setNotifications(false)}/>} {privacy&&<PrivacyModal onClose={()=>setPrivacy(false)}/>} {secret&&<SettingsModal onClose={()=>setSecret(false)} onSuccess={()=>onChange({...profile,is_pro:true})}/>}</Modal>;
}
