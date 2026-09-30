
"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowUp,Bookmark,Camera,Check,Mic,Play,Square,SwitchCamera,Upload,X,Zap,ZapOff} from "lucide-react";
import {imageFile} from "@/lib/media";
import {errorText} from "@/lib/types";
import {saveSticker} from "@/lib/stickers";
import {Modal,IconButton,Spinner,ErrorNote} from "./UI";
export function VoiceRecorder({onSend,onClose}:{onSend:(b:Blob)=>Promise<void>;onClose:()=>void}){
 const [state,setState]=useState("starting"),[seconds,setSeconds]=useState(0),[error,setError]=useState("");const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),cancelled=useRef(false);
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setInterval>;cancelled.current=false;
 void (async()=>{try{if(!navigator.mediaDevices||!window.MediaRecorder)throw new Error("Voice recording is unavailable in this browser.");
 const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});if(!active){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
 const mime=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(x=>MediaRecorder.isTypeSupported(x));
 const r=new MediaRecorder(media,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});recorder.current=r;const chunks:BlobPart[]=[];
 r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 r.onerror=()=>{if(active){setError("Recording failed.");setState("error");}media.getTracks().forEach(t=>t.stop());clearInterval(timer);};
 r.onstop=()=>{media.getTracks().forEach(t=>t.stop());clearInterval(timer);if(active&&!cancelled.current){const blob=new Blob(chunks,{type:r.mimeType.split(";")[0]});if(blob.size<256){setError("Recording was too short.");setState("error");return;}setState("sending");void onSend(blob).then(()=>{if(active)onClose();}).catch(e=>{if(active){setError(errorText(e));setState("error");}});}};
 r.start(1000);setState("recording");const start=Date.now();timer=setInterval(()=>{const n=Math.floor((Date.now()-start)/1000);if(active)setSeconds(n);if(n>=120&&r.state==="recording")r.stop();},250);
 }catch(e){if(active){setError(errorText(e));setState("error");}}})();return()=>{active=false;cancelled.current=true;clearInterval(timer);if(recorder.current?.state==="recording")recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());};},[]);
 return <Modal title="Voice note" onClose={onClose}><div className="voice-record panel-pad"><Mic size={35} className={state==="recording"?"recording":""}/><strong>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,"0")}</strong><div className="waveform" aria-hidden="true">{Array.from({length:25},(_,i)=><i key={i} style={{height:8+(i*13%29)}}/>)}</div><ErrorNote text={error}/>{state==="recording"?<button className="primary" aria-label="Stop and send recording" onClick={()=>recorder.current?.stop()}><Square size={18}/><ArrowUp size={18}/></button>:state!=="error"&&<Spinner/>}</div></Modal>;
}
export function CameraCapture({isPro,onSend,onClose}:{isPro:boolean;onSend:(b:Blob,source:"camera"|"file",allowReplay:boolean)=>Promise<void>;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),input=useRef<HTMLInputElement>(null),alive=useRef(true),lock=useRef(false);
 const [allowReplay,setAllowReplay]=useState(false),[front,setFront]=useState(true),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [flash,setFlash]=useState(false),[torch,setTorch]=useState(false),[flashing,setFlashing]=useState(false),[paused,setPaused]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true;setReady(false);setTorch(false);setError("");
  const stop=()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(video.current)video.current.srcObject=null;};
  const hide=()=>{if(document.visibilityState==="hidden"){stop();setPaused(true);}};
  const pagehide=()=>{stop();setPaused(true);};
  document.addEventListener("visibilitychange",hide);window.addEventListener("pagehide",pagehide);
  if(!paused)void(async()=>{try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera unavailable.");
   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:front?"user":"environment",width:{ideal:1280},height:{ideal:1280}},audio:false});
   if(!active||document.visibilityState==="hidden"){media.getTracks().forEach(track=>track.stop());return;}
   stream.current=media;const track=media.getVideoTracks()[0],capabilities=track?.getCapabilities?.() as (MediaTrackCapabilities & {torch?:boolean})|undefined;
   setTorch(!!capabilities?.torch&&!front);
   if(video.current){video.current.srcObject=media;await video.current.play();}
  }catch(e){if(active){stop();setError(errorText(e));}}})();
  return()=>{active=false;stop();document.removeEventListener("visibilitychange",hide);window.removeEventListener("pagehide",pagehide);};
 },[front,paused]);
 useEffect(()=>{
  const track=stream.current?.getVideoTracks()[0];if(!torch||!track)return;
  void track.applyConstraints({advanced:[{torch:flash} as MediaTrackConstraintSet]}).catch(()=>{if(alive.current)setTorch(false);});
  return()=>{if(track.readyState==="live")void track.applyConstraints({advanced:[{torch:false} as MediaTrackConstraintSet]}).catch(()=>{});};
 },[flash,torch]);
 async function deliver(blob:Blob,source:"camera"|"file"){
  const image=await imageFile(blob);if(!alive.current)return;
  await onSend(image,source,allowReplay);if(alive.current)onClose();
 }
 async function run(source:"camera"|"file",file?:Blob){
  if(lock.current||(!file&&(!ready||paused)))return;lock.current=true;setBusy(true);setError("");
  try{
   if(file){await deliver(file,source);return;}
   if(flash&&!torch){setFlashing(true);await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,130)));}
   if(!alive.current||document.visibilityState==="hidden")return;
   const v=video.current;if(!v?.videoWidth||!v.videoHeight||!stream.current)throw new Error("Camera is not ready.");
   const canvas=document.createElement("canvas");canvas.width=v.videoWidth;canvas.height=v.videoHeight;
   const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Camera capture unavailable.");
   if(front){ctx.translate(canvas.width,0);ctx.scale(-1,1);}ctx.drawImage(v,0,0);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",.88));
   canvas.width=0;canvas.height=0;setFlashing(false);if(!blob)throw new Error("Photo unavailable.");await deliver(blob,"camera");
  }catch(e){if(alive.current)setError(errorText(e));}finally{lock.current=false;if(alive.current){setBusy(false);setFlashing(false);}}
 }
 return <Modal title="Instant" onClose={onClose}><div className="camera-preview"><video ref={video} muted playsInline autoPlay onLoadedData={()=>{if(stream.current)setReady(true);}} style={{transform:front?"scaleX(-1)":undefined}}/>{paused&&<button className="camera-resume" onClick={()=>setPaused(false)}><Play size={24}/>Resume camera</button>}<IconButton label={torch?"Flash":"Screen flash"} aria-pressed={flash} className={"camera-flash "+(flash?"active":"")} disabled={busy||paused} onClick={()=>setFlash(!flash)}>{flash?<Zap size={21}/>:<ZapOff size={21}/>}</IconButton>{flashing&&<div className="screen-flash" aria-hidden="true"/>}</div><div className="panel-pad"><button className="menu-item replay-toggle" type="button" disabled={busy} onClick={()=>setAllowReplay(!allowReplay)}><span>Allow replay & save</span><span className={"switch "+(allowReplay?"on":"")} role="switch" aria-label="Allow replay and save" aria-checked={allowReplay}/></button><ErrorNote text={error}/><div className="row space-between"><IconButton label="Switch camera" disabled={busy||paused} onClick={()=>setFront(!front)}><SwitchCamera size={24}/></IconButton><button className="shutter" aria-label={allowReplay?"Take and send replayable photo":"Take and send one-view photo"} disabled={!ready||busy||paused} onClick={()=>void run("camera")}>{busy?<Spinner/>:<Camera size={25}/>}</button>{isPro?<IconButton label="Upload one-view photo" disabled={busy} onClick={()=>input.current?.click()}><Upload size={24}/></IconButton>:<span className="icon-button"/>}</div><input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={e=>{const x=e.target.files?.[0];e.target.value="";if(x)void run("file",x);}}/></div></Modal>;
}
export function StickerMaker({userId,onSend,onClose}:{userId:string;onSend:(b:Blob)=>Promise<void>;onClose:()=>void}){
 const [emoji,setEmoji]=useState("🫶"),[text,setText]=useState(""),[photo,setPhoto]=useState<Blob|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState("");
 const canvas=useRef<HTMLCanvasElement>(null),input=useRef<HTMLInputElement>(null),lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true;setReady(false);setSaved(false);void(async()=>{
  const c=canvas.current,ctx=c?.getContext("2d");if(!c||!ctx)return;ctx.clearRect(0,0,512,512);
  if(photo){const img=await createImageBitmap(photo);if(!active){img.close();return;}
   const scale=Math.max(512/img.width,512/img.height);ctx.drawImage(img,(512-img.width*scale)/2,(512-img.height*scale)/2,img.width*scale,img.height*scale);img.close();
  }else{ctx.font="240px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(emoji,256,230);}
  if(text.trim()){ctx.font="bold 43px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.lineWidth=12;ctx.strokeStyle="#17171b";ctx.strokeText(text.trim(),256,432,460);ctx.fillStyle="#ffffff";ctx.fillText(text.trim(),256,432,460);}
  if(active)setReady(true);
 })().catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[emoji,text,photo]);
 async function finish(save:boolean){if(lock.current||!ready)return;lock.current=true;setBusy(true);setError("");try{
  const c=canvas.current;if(!c)throw new Error("Sticker unavailable.");const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,"image/webp",.88));if(!blob)throw new Error("Sticker unavailable.");
  if(save){await saveSticker(userId,blob);if(alive.current)setSaved(true);}else{await onSend(blob);if(alive.current)onClose();}
 }catch(e){if(alive.current)setError(errorText(e));}finally{lock.current=false;if(alive.current)setBusy(false);}}
 return <Modal title="Create sticker" onClose={onClose}><div className="panel-pad"><canvas width={512} height={512} ref={canvas} className="sticker-canvas" aria-label="Sticker preview"/><div className="emoji-row">{["🫶","😘","🥹","😈","😂","💋","🤍","🐱"].map(e=><button disabled={busy} key={e} onClick={()=>{setEmoji(e);setPhoto(null);}} aria-label={e}>{e}</button>)}</div><input placeholder="…" aria-label="Sticker text" maxLength={20} disabled={busy} value={text} onChange={e=>setText(e.target.value)}/><div className="row spaced"><IconButton label="Sticker from photo" disabled={busy} onClick={()=>input.current?.click()}><Upload size={20}/></IconButton>{photo&&<IconButton label="Remove photo" disabled={busy} onClick={()=>setPhoto(null)}><X size={20}/></IconButton>}<IconButton label={saved?"Sticker saved":"Save sticker"} disabled={busy||!ready||saved} onClick={()=>void finish(true)}>{saved?<Check size={20}/>:<Bookmark size={20}/>}</IconButton><button className="primary push" disabled={busy||!ready} aria-label="Send sticker" onClick={()=>void finish(false)}>{busy?<Spinner/>:<ArrowUp size={22}/>}</button></div><input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const x=e.target.files?.[0];e.target.value="";if(x)try{const blob=await imageFile(x,800);if(alive.current)setPhoto(blob);}catch(e){if(alive.current)setError(errorText(e));}}}/><ErrorNote text={error}/></div></Modal>;
}
