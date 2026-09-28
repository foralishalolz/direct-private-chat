import type { Message } from "./types";
export type Pending={id:string;userId:string;message:Message;attempts:number;nextAt:number;failed:boolean};
type CacheRow={id:string;userId:string;data:unknown;updated:number;bytes:number};
let connection:Promise<IDBDatabase>|undefined;
const stopped=new Set<string>();
const cleared=new Map<string,string>();
export function visibleRows(userId:string,conversationId:string,rows:Message[]){
  const before=cleared.get(userId+":"+conversationId);
  return before?rows.filter(m=>m.created_at>before):rows;
}
export function activate(userId:string){stopped.delete(userId);}
function open():Promise<IDBDatabase>{
  if(!connection) connection=new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){reject(new Error("Offline storage is unavailable."));return;}
    const request=indexedDB.open("bitchat-local-v2",1);
    request.onupgradeneeded=()=>{for(const name of ["cache","outbox"]){const s=request.result.createObjectStore(name,{keyPath:"id"});s.createIndex("userId","userId");}};
    request.onsuccess=()=>{const d=request.result;d.onversionchange=()=>{d.close();connection=undefined;};resolve(d);};
    request.onerror=()=>{connection=undefined;reject(request.error);};
    request.onblocked=()=>{connection=undefined;reject(new Error("Close another BitchAt tab and retry."));};
  });
  return connection;
}
async function tx<T>(name:string,mode:IDBTransactionMode,action:(s:IDBObjectStore,set:(v:T)=>void)=>void):Promise<T>{
  const d=await open();return new Promise((resolve,reject)=>{
    const t=d.transaction(name,mode);let value:T;
    t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error??new Error("Device storage is full."));t.onabort=()=>reject(t.error??new Error("Device storage is full."));
    try{action(t.objectStore(name),v=>{value=v;});}catch(e){t.abort();reject(e);}
  });
}
export async function cached<T>(userId:string,name:string):Promise<T|null>{
  if(stopped.has(userId)) return null;
  try{const r=await tx<CacheRow|undefined>("cache","readonly",(s,set)=>{const q=s.get(userId+":"+name);q.onsuccess=()=>set(q.result);});return !stopped.has(userId)&&r&&Date.now()-r.updated<7*86400000?r.data as T:null;}catch{return null;}
}
export async function cache(userId:string,name:string,data:unknown){
  if(stopped.has(userId)) return false;
  try{
    if(name.startsWith("messages:")&&Array.isArray(data))data=visibleRows(userId,name.slice(9),data);
    const bytes=JSON.stringify(data).length*2;if(bytes>2*1024*1024)return false;
    await tx<void>("cache","readwrite",(s)=>{
      if(stopped.has(userId))return;
      if(name.startsWith("messages:")&&Array.isArray(data))data=visibleRows(userId,name.slice(9),data);
      s.put({id:userId+":"+name,userId,data,updated:Date.now(),bytes});
      const q=s.index("userId").getAll(userId);q.onsuccess=()=>{
        let size=0;(q.result as CacheRow[]).sort((a,b)=>b.updated-a.updated).forEach((r,i)=>{size+=r.bytes;if(i>=40||size>8*1024*1024||Date.now()-r.updated>7*86400000)s.delete(r.id);});
      };
    });return true;
  }catch{return false;}
}
export function cacheable(rows:Message[]):Message[]{return rows.filter(m=>!m.status).slice(-240).map(m=>({...m,media_url:null,media_kind:null,instant_viewed:m.kind==="instant"?true:m.instant_viewed}));}
export function announce(userId:string,row?:Message,removed?:string){if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("bitchat-outbox",{detail:{userId,row,removed}}));}
export async function pending(userId:string):Promise<Pending[]>{
  if(stopped.has(userId))return [];
  try{return await tx<Pending[]>("outbox","readonly",(s,set)=>{const q=s.index("userId").getAll(userId);q.onsuccess=()=>set((q.result as Pending[]).sort((a,b)=>a.message.created_at.localeCompare(b.message.created_at)||a.id.localeCompare(b.id)));});}catch{return [];}
}
export async function enqueue(message:Message){
  if(stopped.has(message.user_id))throw new Error("Sign in again.");
  if(!visibleRows(message.user_id,message.conversation_id,[message]).length)throw new Error("This chat was cleared.");
  if(message.kind==="instant")throw new Error("Instants need a connection.");
  await tx<void>("outbox","readwrite",s=>{
    const count=s.index("userId").count(message.user_id);
    count.onsuccess=()=>{const previous=s.get(message.id);previous.onsuccess=()=>{
      if(!previous.result&&count.result>=100){s.transaction.abort();return;}
      if(stopped.has(message.user_id)){s.transaction.abort();return;}
      s.put({id:message.id,userId:message.user_id,message:{...message,status:"queued"},attempts:0,nextAt:0,failed:false});
    };};
  });
  announce(message.user_id,{...message,status:"queued"});
}
export async function acknowledge(userId:string,id:string){
  await tx<void>("outbox","readwrite",s=>{const q=s.get(id);q.onsuccess=()=>{if(q.result?.userId===userId)s.delete(id);};}).catch(()=>{});
}
export async function updatePending(row:Pending){
  const changed=await tx<boolean>("outbox","readwrite",(s,set)=>{const q=s.get(row.id);q.onsuccess=()=>{if(!stopped.has(row.userId)&&q.result?.userId===row.userId){s.put(row);set(true);}else set(false);};}).catch(()=>false);
  if(changed)announce(row.userId,{...row.message,status:row.failed?"failed":"queued"});
}
export async function clearUser(userId:string){
  stopped.add(userId);
  for(const name of ["cache","outbox"])await tx<void>(name,"readwrite",s=>{const q=s.index("userId").openKeyCursor(IDBKeyRange.only(userId));q.onsuccess=()=>{const cursor=q.result;if(cursor){s.delete(cursor.primaryKey);cursor.continue();}};}).catch(()=>{});
}

/** Prevent a delayed unmount or retry from restoring a cleared conversation. */
export async function clearConversation(userId:string,conversationId:string,before:string){
  const key=userId+":"+conversationId;
  if((cleared.get(key)??"")<before)cleared.set(key,before);
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("bitchat-chat-cleared",{detail:{userId,conversationId,before}}));
  await tx<void>("cache","readwrite",s=>{
    s.delete(userId+":messages:"+conversationId);
    s.delete(userId+":inbox");
  }).catch(()=>{});
  await tx<void>("outbox","readwrite",s=>{
    const q=s.index("userId").getAll(userId);q.onsuccess=()=>{
      for(const row of q.result as Pending[])if(row.message.conversation_id===conversationId&&row.message.created_at<=before)s.delete(row.id);
    };
  }).catch(()=>{});
}
