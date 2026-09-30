
"use client";
import {useEffect,useState} from "react";
import type {Session} from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import {db} from "@/lib/supabase";
import {activate,cache,cached,clearUser} from "@/lib/offline";
import {disableNotifications} from "@/lib/notifications";
import {clearMedia} from "@/lib/media";
import {PrivacyProvider} from "@/hooks/usePrivacy";
import {useOutbox} from "@/hooks/useOutbox";
import {errorText,type Profile} from "@/lib/types";
import AuthScreen from "@/components/AuthScreen";
import {Brand,ErrorNote,Spinner} from "@/components/UI";
const ChatRoom=dynamic(()=>import("@/components/ChatRoom"),{loading:()=> <div className="loading-screen"><Brand/><Spinner/></div>});
export default function Home(){
 const [session,setSession]=useState<Session|null>(null),[profile,setProfile]=useState<Profile|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(""),[version,setVersion]=useState(0);
 useOutbox(session?.user.id);
 useEffect(()=>{let alive=true,authRevision=0,activeAccount:string|null=null;const client=db();
 const applySession=(next:Session|null)=>{if(!alive)return;const previous=activeAccount;activeAccount=next?.user.id??null;if(previous&&previous!==activeAccount)queueMicrotask(()=>{void disableNotifications(previous).catch(()=>{});});setSession(next);setReady(true);};
 void client.auth.getSession().then(({data,error})=>{if(alive&&authRevision===0){applySession(data.session);if(error)setError(errorText(error));}}).catch(cause=>{if(alive&&authRevision===0){setError(errorText(cause));setReady(true);}});
 const {data}=client.auth.onAuthStateChange((_event,next)=>{authRevision++;applySession(next);});
 if("serviceWorker" in navigator&&process.env.NODE_ENV==="production")void navigator.serviceWorker.register("/sw.js").catch(()=>{});
 return()=>{alive=false;data.subscription.unsubscribe();};},[]);
 useEffect(()=>{let active=true;setProfile(null);if(!session?.user.id)return;const id=session.user.id;activate(id);
 void (async()=>{const saved=await cached<Profile>(id,"profile");if(active&&saved)setProfile(saved);const r=await db().from("profiles").select("id,username,display_name,avatar_url,mood,is_pro").eq("id",id).single();if(!active)return;if(r.error){setError(errorText(r.error));return;}setProfile(r.data as Profile);setError("");void cache(id,"profile",r.data);})();
 return()=>{active=false;};},[session?.user.id,version]);
 async function logout(){const id=session?.user.id;setProfile(null);clearMedia();if(id){await disableNotifications(id).catch(()=>{});await clearUser(id);}await db().auth.signOut({scope:"local"});setSession(null);}
 if(!ready)return <main className="loading-screen"><Brand/><Spinner/></main>;
 if(!session)return <AuthScreen initialError={error}/>;
 if(!profile)return <main className="loading-screen"><Brand/>{error?<><ErrorNote text={error}/><button className="primary" onClick={()=>setVersion(x=>x+1)}>Retry</button><button onClick={()=>void logout()}>Log out</button></>:<Spinner/>}</main>;
 return <PrivacyProvider key={session.user.id} userId={session.user.id}><ChatRoom key={session.user.id} profile={profile} onProfile={p=>{setProfile(current=>current?.id===p.id?p:current);void cache(p.id,"profile",p);}} onLogout={logout}/></PrivacyProvider>;
}
