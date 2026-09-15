import {imageDimensions} from "./imageDimensions";

import {db} from "./supabase";
const links=new Map<string,{url:string;until:number}>();
const inflight=new Map<string,Promise<string>>();
export function clearMedia(){links.clear();inflight.clear();}
export async function signed(bucket:string,path:string){
  if(!path||path.startsWith("http")||path.includes(".."))throw new Error("Media unavailable.");
  const user=(await db().auth.getSession()).data.session?.user.id;
  if(!user)throw new Error("Sign in again.");
  const key=user+":"+bucket+":"+path,hit=links.get(key);
  if(hit&&hit.until>Date.now())return hit.url;
  const existing=inflight.get(key);if(existing)return existing;
  const promise=(async()=>{const r=await db().storage.from(bucket).createSignedUrl(path,60);if(r.error)throw r.error;
    if(links.size>180)links.delete(links.keys().next().value!);
    links.set(key,{url:r.data.signedUrl,until:Date.now()+45000});return r.data.signedUrl;
  })().finally(()=>inflight.delete(key));inflight.set(key,promise);return promise;
}
export async function imageFile(file:Blob,max=1600):Promise<Blob>{
  if(file.size>12*1024*1024)throw new Error("Photo must be under 12 MB.");
  const b=new Uint8Array(await file.slice(0,32).arrayBuffer());
  const png=b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71;
  const jpg=b[0]===255&&b[1]===216&&b[2]===255;
  const webp=String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP";
  if(!png&&!jpg&&!webp)throw new Error("Choose a JPEG, PNG or WebP photo.");
  if(png){const v=new DataView(b.buffer);if(v.getUint32(16)*v.getUint32(20)>24e6)throw new Error("Photo dimensions are too large.");}
  imageDimensions(new Uint8Array(await file.arrayBuffer()));
  const bitmap=await createImageBitmap(file);
  try{if(bitmap.width*bitmap.height>24e6||Math.max(bitmap.width,bitmap.height)>12000)throw new Error("Photo dimensions are too large.");
    const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Photo unavailable.");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error("Could not prepare photo.")),"image/webp",0.82));
  }finally{bitmap.close();}
}
export async function upload(user:string,conversation:string|null,blob:Blob,bucket="chat-media"){
  const limit=bucket==="avatars"?5:bucket==="chat-media"?25:10;
  if(blob.size>limit*1024*1024)throw new Error("File must be under "+limit+" MB.");
  const mime=blob.type.split(";")[0],extensions:Record<string,string>={"image/webp":"webp","image/jpeg":"jpg","image/png":"png","image/gif":"gif","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov","audio/webm":"webm","audio/mp4":"m4a","audio/ogg":"ogg","audio/mpeg":"mp3","audio/wav":"wav"};
  const ext=extensions[mime];if(!ext)throw new Error("This file type is unavailable.");
  const path=user+"/"+(conversation?conversation+"/":"")+crypto.randomUUID()+"."+ext;
  const r=await db().storage.from(bucket).upload(path,blob,{contentType:mime,cacheControl:"0",upsert:false});if(r.error)throw r.error;return path;
}
