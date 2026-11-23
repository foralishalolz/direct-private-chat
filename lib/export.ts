
import {db} from "./supabase";
import {label,title,type Conversation,type Message} from "./types";
export function saveBlob(blob:Blob,name:string){
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function downloadMedia(path:string,bucket="chat-media"){
 const {data,error}=await db().storage.from(bucket).download(path);if(error||!data)throw error??new Error("Media unavailable.");
 saveBlob(data,"BitchAt-"+(path.split("/").at(-1)??"media"));
}
export async function exportChat(c:Conversation,signal?:AbortSignal){
 const parts:BlobPart[]=["BitchAt · "+title(c)+"\nExported "+new Date().toISOString()+"\n\n"];let cursor:Message|undefined,bytes=0;
 while(true){let q=db().from("messages").select("*").eq("conversation_id",c.id).order("created_at",{ascending:true}).order("id",{ascending:true}).limit(500);
 if(cursor)q=q.or("created_at.gt."+cursor.created_at+",and(created_at.eq."+cursor.created_at+",id.gt."+cursor.id+")");if(signal)q=q.abortSignal(signal);
 const r=await q;if(r.error)throw r.error;if(!r.data.length)break;
 const lines=(r.data as Message[]).map(m=>"["+m.created_at+"] "+(label(c.members?.find(p=>p.id===m.user_id))||m.user_id)+": "+(m.kind==="instant"?"[One-view photo]":m.kind==="miss"?"🤍":m.content)+(m.media_kind?" ["+m.media_kind+"]":"")+"\n").join("");
 bytes+=new TextEncoder().encode(lines).byteLength;if(bytes>100*1024*1024)throw new Error("This export exceeds 100 MB.");
 parts.push(lines);cursor=r.data.at(-1) as Message;if(r.data.length<500)break;
 }
 if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
 saveBlob(new Blob(parts,{type:"text/plain;charset=utf-8"}),"BitchAt-"+title(c).replace(/[^a-z0-9_-]/gi,"_").slice(0,50)+"-"+new Date().toISOString().slice(0,10)+".txt");
}
