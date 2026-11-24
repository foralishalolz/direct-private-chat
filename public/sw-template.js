
/* Application shell only. Auth, API responses, signed media and user content are never cached here. */
self.addEventListener("install",event=>{event.waitUntil(caches.open(VERSION).then(async cache=>{try{await cache.addAll(ASSETS);await self.skipWaiting();}catch(error){await caches.delete(VERSION);throw error;}}));});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const previous=(await caches.keys()).filter(name=>name.startsWith("bitchat-shell-")&&name!==VERSION);for(const name of previous.slice(0,-1))await caches.delete(name);await self.clients.claim();})());});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(request.mode==="navigate"){event.respondWith(fetch(request).catch(async()=>{const cached=await caches.match("/index.html");return cached||new Response("",{status:503});}));return;}
 if(!ASSETS.includes(url.pathname)){if(url.pathname.startsWith("/_next/static/"))event.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(request)));return;}
 event.respondWith(caches.open(VERSION).then(async cache=>(await cache.match(url.pathname))||fetch(request)).catch(()=>fetch(request)));
});

// Store only the current opt-in and bounded message IDs, never chat contents or auth tokens.
function acceptPush(data){return new Promise((resolve,reject)=>{
 const request=indexedDB.open("bitchat-push-v1",1);
 request.onupgradeneeded=()=>{request.result.createObjectStore("state");request.result.createObjectStore("seen",{keyPath:"id"});};
 request.onerror=()=>reject(request.error);
 request.onblocked=()=>resolve(false);
 request.onsuccess=()=>{
  const db=request.result,tx=db.transaction(["state","seen"],"readwrite"),state=tx.objectStore("state"),seen=tx.objectStore("seen");
  const owner=state.get("owner"),duplicate=seen.get(data.userId+":"+data.messageId);let ownerDone=false,duplicateDone=false,allowed=false;
  function decide(){if(!ownerDone||!duplicateDone)return;
   if(!owner.result?.enabled||owner.result.userId!==data.userId||duplicate.result)return;
   allowed=true;seen.put({id:data.userId+":"+data.messageId,at:Date.now()});
   const all=seen.getAll();all.onsuccess=()=>{all.result.sort((a,b)=>b.at-a.at).forEach((item,index)=>{if(index>=200||item.at<Date.now()-86400000)seen.delete(item.id);});};
  }
  owner.onsuccess=()=>{ownerDone=true;decide();};duplicate.onsuccess=()=>{duplicateDone=true;decide();};
  tx.oncomplete=()=>{db.close();resolve(allowed);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
 };
});}
// BroadcastChannel is used by the page to relay a push while a tab is open.
self.addEventListener("push",event=>{
 let data;try{data=event.data?.json();}catch{return;}

 const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!data||!valid.test(data.userId||""))return;
 if(data.kind==="call"&&data.callId){
  // A ringing call is a live event, not a message: no staleness window beyond
  // one minute, a call tag that replaced calls inherit, and buttons that can
  // open the call screen for a microphone permission gesture.
  if(!valid.test(data.conversationId||"")||!valid.test(data.callId)||typeof data.timestamp!=="number"||!Number.isFinite(data.timestamp)||Date.now()-data.timestamp>60000||data.timestamp-Date.now()>120000)return;
  event.waitUntil((async()=>{
   if(!await acceptPush({...data,messageId:"call:"+data.callId}))return;
   await self.registration.showNotification("Incoming BitchAt call",{
    body:"Open to answer",
    icon:"/icon-192.png",badge:"/badge.png",
    tag:"call:"+data.userId+":"+data.conversationId,renotify:true,
    requireInteraction:true,silent:false,
    vibrate:[300,120,300,120,300],
    actions:[{action:"accept",title:"Open call"},{action:"decline",title:"Decline"}],
    data:{userId:data.userId,conversationId:data.conversationId,callId:data.callId,kind:"call"},
   });
  })().catch(()=>{}));
  return;
 }
 if(!valid.test(data.conversationId||"")||!valid.test(data.messageId||"")||typeof data.timestamp!=="number"||!Number.isFinite(data.timestamp)||Date.now()-data.timestamp>3660000||data.timestamp-Date.now()>120000)return;
 event.waitUntil((async()=>{
  if(!await acceptPush(data))return;
  await self.registration.showNotification("BitchAt",{body:"New message",icon:"/icon-192.png",badge:"/badge.png",tag:"bitchat:"+data.userId+":"+data.conversationId,data:{userId:data.userId,conversationId:data.conversationId,messageId:data.messageId}});
 })().catch(()=>{}));
});

self.addEventListener("notificationclick",event=>{
 event.notification.close();const data=event.notification.data||{};
 const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!valid.test(data.userId||"")||!valid.test(data.conversationId||""))return;
 const callId=valid.test(data.callId||"")?data.callId:"";
 event.waitUntil((async()=>{
  // Open the ringing screen or pass a decline intent to the app.
  if(data.kind==="call"&&callId){
   const action=event.action;
   const url="/?call="+encodeURIComponent(callId)+"&chat="+encodeURIComponent(data.conversationId)+"&account="+encodeURIComponent(data.userId)+(action==="decline"?"&decline=1":action==="accept"?"&accept=1":"");
   const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
   for(const client of windows){
    if(new URL(client.url).origin!==self.location.origin)continue;
    await client.focus();
    client.postMessage({type:"bitchat-open-call",callId,conversationId:data.conversationId,userId:data.userId,action:action||"open"});
    return;
   }
   await self.clients.openWindow(url);
   return;
  }
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();client.postMessage({type:"bitchat-open-chat",userId:data.userId,conversationId:data.conversationId});return;}}
  await self.clients.openWindow("/?chat="+encodeURIComponent(data.conversationId)+"&account="+encodeURIComponent(data.userId));
 })().catch(()=>{}));
});
