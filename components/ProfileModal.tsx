
"use client";
import {useRef,useState} from "react";
import {Bell,Camera,Check,LogOut,Settings,ShieldCheck,EyeOff} from "lucide-react";
import {db} from "@/lib/supabase";
import {imageFile,upload} from "@/lib/media";
import {MOODS,errorText,type Profile} from "@/lib/types";
import {Avatar,Modal,IconButton,ErrorNote,Spinner} from "./UI";
import NotificationsModal from "./NotificationsModal";
import PrivacyModal from "./PrivacyModal";
import SettingsModal from "./SettingsModal";
export default function ProfileModal({profile,onChange,onClose,onLogout}:{profile:Profile;onChange:(p:Profile)=>void;onClose:()=>void;onLogout:()=>Promise<void>}){
 const [name,setName]=useState(profile.display_name??""),[mood,setMood]=useState(profile.mood),[busy,setBusy]=useState(false),[error,setError]=useState(""),[secret,setSecret]=useState(false),[privacy,setPrivacy]=useState(false),[notifications,setNotifications]=useState(false);const file=useRef<HTMLInputElement>(null);
 async function save(patch:Partial<Profile>){setBusy(true);setError("");try{const r=await db().from("profiles").update(patch).eq("id",profile.id).select("id,username,display_name,avatar_url,mood,is_pro").single();if(r.error)throw r.error;onChange(r.data as Profile);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <Modal title="Profile" onClose={onClose}><div className="profile-edit"><button className="avatar-edit" aria-label="Change profile photo" disabled={busy} onClick={()=>file.current?.click()}><Avatar profile={profile} size={88}/><span><Camera size={16}/></span></button><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async e=>{const photo=e.target.files?.[0];e.target.value="";if(!photo)return;setBusy(true);try{const path=await upload(profile.id,null,await imageFile(photo,512),"avatars");await save({avatar_url:path});}catch(e){setError(errorText(e));}finally{setBusy(false);}}}/><p className="muted">@{profile.username} {profile.is_pro&&<ShieldCheck size={16}/>}</p><input aria-label="Display name" placeholder="Name" value={name} maxLength={40} onChange={e=>setName(e.target.value)}/><div className="emoji-row">{MOODS.map(x=><button className={x===mood?"selected":""} aria-label={x} aria-pressed={x===mood} key={x} onClick={()=>setMood(x===mood?null:x)}>{x}</button>)}</div><ErrorNote text={error}/><div className="row"><IconButton label="Log out" onClick={()=>void onLogout()}><LogOut size={20}/></IconButton><IconButton label="Privacy" onClick={()=>setPrivacy(true)}><EyeOff size={21}/></IconButton><IconButton label="Notifications" onClick={()=>setNotifications(true)}><Bell size={20}/></IconButton><IconButton label="Settings" onClick={()=>setSecret(true)}><Settings size={20}/></IconButton><button className="primary push" disabled={busy} aria-label="Save profile" onClick={()=>void save({display_name:name.trim(),mood})}>{busy?<Spinner/>:<Check size={21}/>}</button></div></div>{notifications&&<NotificationsModal userId={profile.id} onClose={()=>setNotifications(false)}/>} {privacy&&<PrivacyModal onClose={()=>setPrivacy(false)}/>} {secret&&<SettingsModal onClose={()=>setSecret(false)} onSuccess={()=>onChange({...profile,is_pro:true})}/>}</Modal>;
}

