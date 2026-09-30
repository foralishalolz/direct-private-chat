
/* Application shell only. Auth, API responses, signed media and user content are never cached here. */
self.addEventListener("install",event=>{event.waitUntil(caches.open(VERSION).then(async cache=>{try{await cache.addAll(ASSETS);}catch(error){await caches.delete(VERSION);throw error;}}));});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith("bitchat-shell-")&&name!==VERSION)await caches.delete(name);await self.clients.claim();})());});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(request.mode==="navigate"){event.respondWith(fetch(request).catch(async()=>{const cached=await caches.match("/index.html");return cached||new Response("",{status:503});}));return;}
 if(!ASSETS.includes(url.pathname))return;
 event.respondWith(caches.open(VERSION).then(async cache=>(await cache.match(url.pathname))||fetch(request)).catch(()=>fetch(request)));
});


self.addEventListener("notificationclick",event=>{
 event.notification.close();const data=event.notification.data||{};
 const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!valid.test(data.userId||"")||!valid.test(data.conversationId||""))return;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();client.postMessage({type:"bitchat-open-chat",userId:data.userId,conversationId:data.conversationId});return;}}
  await self.clients.openWindow("/?chat="+encodeURIComponent(data.conversationId)+"&account="+encodeURIComponent(data.userId));
 })());
});
