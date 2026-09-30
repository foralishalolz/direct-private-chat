import { test, expect, type Page, type Locator } from "@playwright/test";
const uid="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",third="55555555-5555-4555-8555-555555555555";
const cid="33333333-3333-4333-8333-333333333333",gid="66666666-6666-4666-8666-666666666666";
const stamp=new Date(Date.now()-60000).toISOString(),code="abcdef0123456789abcdef0123456789";
const self={id:uid,username:"sam",display_name:"Sam",avatar_url:null,mood:"😊",is_pro:true};
const alex={...self,id:other,username:"alex",display_name:"Alex",mood:"🫶",is_pro:false};
const maya={...alex,id:third,username:"maya",display_name:"Maya",mood:null};
const direct={id:cid,kind:"direct",title:"",member_a:uid,member_b:other,created_by:uid,created_at:stamp,last_activity:stamp,read_a:stamp,read_b:stamp,couple_a:false,couple_b:false,members:[self,alex],preview:"See you soon ✨",read_at:stamp};
const group={...direct,id:gid,kind:"group",title:"Weekend crew",member_a:null,member_b:null,members:[self,alex,maya],preview:"Saturday sounds perfect",member_reads:[{user_id:other,read_at:stamp}]};
const messages=[{id:"77777777-7777-4777-8777-777777777777",conversation_id:cid,user_id:other,content:"Coffee after work? ☕",media_url:null,media_kind:null,kind:"message",instant_viewed:false,created_at:new Date(Date.now()-120000).toISOString()},{id:"88888888-8888-4888-8888-888888888888",conversation_id:cid,user_id:uid,content:"Absolutely. Same place, 6:30?",media_url:null,media_kind:null,kind:"message",instant_viewed:false,created_at:stamp}];
async function mock(page:Page,instants=false,pro=true,couple=false){
 const me={...self,is_pro:pro};let rows=messages.map(m=>({...m}));let reactions:{message_id:string;user_id:string;emoji:string}[]=[];
 const calls:{name:string;body:Record<string,unknown>}[]=[];let hidden=false,left=false;const archived=new Set<string>();let privacy={revision:0,share_online:true,share_last_active:true,share_typing:true,share_receipts:true};
 await page.addInitScript(({uid})=>{const token=btoa(JSON.stringify({alg:"HS256"}))+"."+btoa(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600,aud:"authenticated",role:"authenticated"}))+".test";localStorage.setItem("sb-llweydgvtpwgnslvgnqm-auth-token",JSON.stringify({access_token:token,refresh_token:"test",expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:"bearer",user:{id:uid,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{}}}));},{uid});
 await page.route("**/rest/v1/**",async route=>{
  const url=new URL(route.request().url()),name=url.pathname.split("/").at(-1)!;const bodyIn=route.request().postDataJSON()??{};let body:unknown=[];
  if(route.request().method()==="POST")calls.push({name,body:bodyIn});
  if(name==="my_privacy")body=privacy;
  if(name==="set_privacy_option"){privacy={...privacy,[String(bodyIn.p_setting)]:!!bodyIn.p_enabled,revision:privacy.revision+1};body=privacy;}
  if(name==="member_activity")body=[{user_id:other,online:false,last_active:new Date(Date.now()-7260000).toISOString()}];
  if(name==="profiles")body=url.searchParams.get("id")?.startsWith("in.")?[me,alex,maya]:me;
  if(name==="push_public_key")body="B"+"A".repeat(86);
  if(name==="register_push_subscription"||name==="unregister_push_subscription")body=null;
  if(name==="ensure_goal"||name==="games")body=null;
  if(name==="inbox_page")body=[...(!hidden?[direct]:[]),...(!left?[group]:[])].map(c=>({...c,archived:archived.has(c.id),couple_a:couple,couple_b:couple}));
  if(name==="set_chat_archived"){const id=String(bodyIn.p_conversation);if(bodyIn.p_archived)archived.add(id);else archived.delete(id);body=!!bodyIn.p_archived;}
  if(name==="conversations")body=url.searchParams.get("id")?.includes(gid)?group:direct;
  if(name==="conversation_members")body=[self,alex,maya].map(p=>({user_id:p.id,last_read_at:stamp}));
  if(name==="messages"&&route.request().method()==="PATCH"){const id=url.searchParams.get("id")?.slice(3);rows=rows.map(m=>m.id===id?{...m,content:String(bodyIn.content)}:m);body=rows.find(m=>m.id===id);}
  if(name==="messages"&&route.request().method()==="DELETE"){const id=url.searchParams.get("id")?.slice(3);rows=rows.filter(m=>m.id!==id);body=[{id}];}
  if(name==="reactions")body=reactions;
  if(name==="set_reaction"){reactions=reactions.filter(r=>r.message_id!==bodyIn.p_message||r.user_id!==uid);if(bodyIn.p_emoji)reactions.push({message_id:String(bodyIn.p_message),user_id:uid,emoji:String(bodyIn.p_emoji)});body=null;}
  if(name==="messages"&&route.request().method()==="POST"){const message={...messages[0],...bodyIn,user_id:uid,created_at:new Date().toISOString()};rows=rows.filter(m=>m.id!==message.id);rows.push(message);body=message;}
  if(name==="messages"&&route.request().method()==="GET")body=rows.map(m=>({...m,conversation_id:url.searchParams.get("conversation_id")?.includes(gid)?gid:cid}));
  if(name==="messages"&&instants)body=[...messages,...[false,true].map((replay,i)=>({...messages[0],id:`99999999-9999-4999-8999-99999999999${i}`,content:"",kind:"instant",per_recipient:true,allow_replay:replay,created_at:stamp}))];
  if(name==="message_receipts")body=[{...alex,user_id:other,read_at:stamp},{...maya,user_id:third,read_at:null}];
  if(name==="group_invite")body=bodyIn.p_revoke?null:code;
  if(name==="join_group"){left=false;body=gid;}
  if(name==="leave_group"){left=true;body=null;}
  if(name==="clear_chat"){hidden=true;body=new Date().toISOString();}
  if(name==="message_history")body=[{id:messages[1].id,message_id:messages[1].id,username:"sam",kind:"edited",before_content:"At seven?",after_content:"At six thirty?",created_at:stamp,event_at:stamp,media_url:null,media_kind:null}].filter(x=>bodyIn.p_kind==="all"||bodyIn.p_kind===x.kind);
  if(name==="quick_play")body=bodyIn.p_id;
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
 });
 await page.routeWebSocket("wss://llweydgvtpwgnslvgnqm.supabase.co/**",socket=>socket.onMessage(raw=>{try{const m=JSON.parse(String(raw));if(Array.isArray(m))socket.send(JSON.stringify([m[0],m[1],m[2],"phx_reply",{status:"ok",response:{postgres_changes:[]}}]));}catch{}}));
 await page.goto("/");await expect(page.locator(".conversation")).toHaveCount(2);
 return calls;
}
async function openChat(page:Page,isGroup=false){await page.locator(".conversation").filter({hasText:isGroup?"Weekend crew":"Alex"}).click();await expect(page.locator(".message-text").filter({hasText:"Absolutely"})).toBeVisible();}

async function dragChat(page:Page, row:Locator, mobile:boolean, dx:number, dy=0){
 const box=await row.boundingBox();if(!box)throw new Error("Chat row unavailable.");
 const x=box.x+(dx>0?Math.min(25,box.width/4):Math.min(box.width-15,220)),y=box.y+box.height/2;
 if(mobile){const session=await page.context().newCDPSession(page);
  try{await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
   for(let i=1;i<=6;i++)await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx*i/6,y:y+dy*i/6,id:1}]});
   await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  }finally{await session.detach();}
 }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();}
}

test("read receipts show member status without an edited label in chat",async({page})=>{
 await mock(page);await openChat(page);await page.getByRole("button",{name:"Read receipts",exact:true}).click();
 await expect(page.getByRole("dialog",{name:"Message info"})).toBeVisible();await expect(page.locator(".member-row").filter({hasText:"Alex"})).toContainText("Seen");await expect(page.locator(".member-row").filter({hasText:"Maya"})).toContainText("Sent");
});
test("delete for me requires confirmation and returns to a cleared inbox",async({page})=>{
 const calls=await mock(page);await openChat(page);await page.locator(".thread-person").click();await page.getByRole("button",{name:"Delete chat",exact:true}).click();
 await expect(page.getByRole("dialog",{name:"Delete chat?"})).toBeVisible();expect(calls.some(c=>c.name==="clear_chat")).toBe(false);
 await page.getByRole("button",{name:"Delete for me",exact:true}).click();await expect(page.getByRole("textbox",{name:"Search chats"})).toBeVisible();await expect(page.locator(".conversation")).toHaveCount(1);expect(calls.find(c=>c.name==="clear_chat")?.body.p_conversation).toBe(cid);
});
test("group members can generate an invite and leave with confirmation",async({page})=>{
 const calls=await mock(page);await openChat(page,true);await page.locator(".thread-person").click();await page.getByRole("button",{name:"Create invite code"}).click();await expect(page.getByRole("textbox",{name:"Group invite code"})).toHaveValue(code);
 await page.getByRole("button",{name:"Leave group",exact:true}).click();await page.getByRole("dialog",{name:"Leave group?"}).getByRole("button",{name:"Leave group",exact:true}).click();await expect(page.getByRole("textbox",{name:"Search chats"})).toBeVisible();await expect(page.locator(".conversation")).toHaveCount(1);expect(calls.find(c=>c.name==="leave_group")?.body.p_conversation).toBe(gid);
});
test("join group rejects an incomplete code locally and opens a valid invite",async({page})=>{
 const calls=await mock(page);await page.locator(".inbox-header").getByRole("button",{name:"New message"}).click();await page.locator(".discover-modes").getByRole("button",{name:"Join group"}).click();
 await page.getByRole("textbox",{name:"Invite code"}).fill("short");await expect(page.locator(".join-form").getByRole("button")).toBeDisabled();
 await page.getByRole("textbox",{name:"Invite code"}).fill(code);await page.locator(".join-form").getByRole("button").click();await expect(page.locator(".thread-person")).toContainText("Weekend crew");expect(calls.find(c=>c.name==="join_group")?.body.p_code).toBe(code);
});
test("Pro history exposes previous text separately from the conversation",async({page})=>{
 await mock(page);await openChat(page);await page.getByRole("button",{name:"Chat menu"}).click();await page.getByRole("button",{name:"Message history",exact:true}).click();await expect(page.locator(".previous-text")).toHaveText("At seven?");await expect(page.locator(".history-card")).toContainText("At six thirty?");await page.getByRole("button",{name:"Deleted",exact:true}).click();await expect(page.getByText("No history",{exact:true})).toBeVisible();
});
test("dice and coin shortcuts submit a shared server action",async({page})=>{
 const calls=await mock(page);await openChat(page,true);await page.locator(".chat-shortcuts").getByRole("button",{name:"Play"}).click();await page.getByRole("button",{name:"Roll a dice"}).click();await expect(page.getByText("Sent to chat",{exact:true})).toBeVisible();await page.getByRole("button",{name:"Flip a coin"}).click();await expect.poll(()=>calls.filter(c=>c.name==="quick_play").map(c=>c.body.p_kind)).toEqual(["dice","coin"]);
});
test("strict instants stay one-view for Pro while consented photos expose replay and save",async({page})=>{
 await mock(page,true);let opens=0;
 await page.route("**/functions/v1/open-instant",route=>{opens++;return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64")});});
 await openChat(page);const strict=page.locator(".instant-card").first();await strict.click();await expect(page.getByRole("img",{name:"One-view photo"})).toBeVisible();await expect(page.getByRole("button",{name:"Save photo"})).toHaveCount(0);await page.getByRole("button",{name:"Close",exact:true}).click();await expect(strict).toBeDisabled();
 const replay=page.locator(".instant-card").last();await replay.click();await expect(page.getByRole("button",{name:"Save photo"})).toBeVisible();await page.getByRole("button",{name:"Close",exact:true}).click();await replay.click();await expect(page.getByRole("img",{name:"Replayable photo"})).toBeVisible();expect(opens).toBe(3);
});
test("settled inbox and conversation visual checkpoints have no overflow or runtime errors",async({page},testInfo)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await mock(page);await page.screenshot({path:testInfo.outputPath("inbox.png")});
 if(process.env.CI)console.log("SOCIAL_INBOX_"+testInfo.project.name+" "+(await page.screenshot({type:"jpeg",quality:65})).toString("base64"));
 await openChat(page);await page.screenshot({path:testInfo.outputPath("conversation.png")});
 if(process.env.CI)console.log("SOCIAL_CHAT_"+testInfo.project.name+" "+(await page.screenshot({type:"jpeg",quality:65})).toString("base64"));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test("privacy switches persist without sending typing events when disabled",async({page})=>{
 const calls=await mock(page);await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Privacy",exact:true}).click();
 const modal=page.getByRole("dialog",{name:"Privacy",exact:true});await expect(modal.getByRole("switch")).toHaveCount(4);
 for(const name of ["Online status","Last active","Typing indicator","Read receipts"]){const toggle=modal.getByRole("switch",{name,exact:true});await expect(toggle).toHaveAttribute("aria-checked","true");await toggle.click();await expect(toggle).toHaveAttribute("aria-checked","false");await expect(toggle).toBeEnabled();}
 expect(calls.filter(c=>c.name==="set_privacy_option").map(c=>c.body)).toEqual(["share_online","share_last_active","share_typing","share_receipts"].map(p_setting=>({p_setting,p_enabled:false})));
 await modal.getByRole("button",{name:"Close",exact:true}).click();await page.getByRole("dialog",{name:"Profile",exact:true}).getByRole("button",{name:"Close",exact:true}).click();await openChat(page);
 await expect(page.locator(".thread-person")).toContainText("Active 2h ago");await page.getByRole("textbox",{name:"Message",exact:true}).fill("A private draft");expect(calls.filter(c=>c.name==="send_typing")).toHaveLength(0);
 if(await page.getByRole("button",{name:"Back to messages"}).isVisible())await page.getByRole("button",{name:"Back to messages"}).click();
 await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Privacy",exact:true}).click();await expect(page.getByRole("switch",{name:"Typing indicator"})).toHaveAttribute("aria-checked","false");
});
test("regular members can edit and delete only their own messages",async({page})=>{
 await mock(page,false,false);await openChat(page);const own=page.locator(".message-row.own");await expect(own.getByRole("button",{name:"Message actions"}).locator("svg")).toHaveCount(1);await own.getByRole("button",{name:"Message actions"}).click();await page.getByRole("button",{name:"Edit",exact:true}).click();await expect(page.getByRole("dialog",{name:"Edit message"})).toBeVisible();await page.getByRole("dialog",{name:"Edit message"}).getByRole("textbox").fill("A regular member edit");await page.getByRole("button",{name:"Save edit"}).click();await expect(own.locator(".message-text")).toHaveText("A regular member edit");await own.getByRole("button",{name:"Message actions"}).click();await page.getByRole("button",{name:"Delete for everyone",exact:true}).click();await expect(own).toHaveCount(0);
 await page.locator(".message-row:not(.own)").getByRole("button",{name:"Message actions"}).click();await expect(page.getByRole("button",{name:"Edit",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Delete for everyone",exact:true})).toHaveCount(0);
});


test("emoji reactions are optimistic, replaceable, removable and rollback on failure",async({page})=>{
 await mock(page,false,false);await openChat(page);const bubble=page.locator(".message-row.own");
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route("**/rest/v1/rpc/set_reaction",async route=>{await gate;await route.fallback();},{times:1});
 await bubble.getByRole("button",{name:"React to message"}).click();await expect(page.getByRole("dialog",{name:"Reactions"}).locator(".reaction-grid button")).toHaveCount(24);
 await page.getByRole("dialog",{name:"Reactions"}).getByRole("button",{name:"👍",exact:true}).click();await expect(bubble.locator(".message-reactions button")).toHaveAttribute("aria-pressed","true");
 release();await expect(page.getByRole("dialog",{name:"Reactions"})).toHaveCount(0);
 await bubble.getByRole("button",{name:"React to message"}).click();await page.getByRole("dialog",{name:"Reactions"}).getByRole("button",{name:"😂",exact:true}).click();await expect(page.getByRole("dialog",{name:"Reactions"})).toHaveCount(0);await expect(bubble.locator(".message-reactions button")).toContainText("😂");await expect(bubble.locator(".message-reactions button")).toHaveCount(1);
 await bubble.locator(".message-reactions button").click();await expect(bubble.locator(".message-reactions button")).toHaveCount(0);
 await page.route("**/rest/v1/rpc/set_reaction",route=>route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({message:"Reaction unavailable"})}));
 await bubble.getByRole("button",{name:"React to message"}).click();await page.getByRole("dialog",{name:"Reactions"}).getByRole("button",{name:"🔥",exact:true}).click();await expect(page.getByRole("dialog",{name:"Reactions"}).getByRole("alert")).toContainText("Reaction unavailable");await expect(bubble.locator(".message-reactions button")).toHaveCount(0);
});

test("composer typing does not refetch messages or reactions",async({page})=>{
 await mock(page);await openChat(page);let reads=0;
 page.on("request",request=>{if(request.method()==="GET"&&/\/rest\/v1\/(messages|reactions)\?/.test(request.url()))reads++;});
 await page.getByRole("textbox",{name:"Message",exact:true}).pressSequentially("An uninterrupted draft with emoji 🫶",{delay:20});expect(reads).toBe(0);
});

test("chat history loads while the realtime handshake is still pending",async({page})=>{
 await mock(page);await page.routeWebSocket("wss://llweydgvtpwgnslvgnqm.supabase.co/**",socket=>socket.onMessage(()=>{}));
 await page.locator(".conversation").filter({hasText:"Alex"}).click();await expect(page.locator(".message-text").filter({hasText:"Absolutely"})).toBeVisible({timeout:1300});
});


test("inbox shortcuts open group creation, invite entry and confirmed deletion",async({page})=>{
 const calls=await mock(page);await page.locator(".inbox-group-actions").getByRole("button",{name:"New group",exact:true}).click();await expect(page.getByRole("textbox",{name:"Group name"})).toBeVisible();await page.getByRole("button",{name:"Close",exact:true}).click();
 await page.locator(".inbox-group-actions").getByRole("button",{name:"Join group",exact:true}).click();await expect(page.getByRole("textbox",{name:"Invite code"})).toBeVisible();await page.getByRole("button",{name:"Close",exact:true}).click();
 await page.locator(".conversation").filter({hasText:"Alex"}).focus();await page.keyboard.press("ArrowLeft");await page.getByRole("button",{name:"Delete chat with Alex",exact:true}).click();await page.getByRole("button",{name:"Cancel",exact:true}).click();expect(calls.some(c=>c.name==="clear_chat")).toBe(false);
 await page.locator(".conversation").filter({hasText:"Alex"}).focus();await page.keyboard.press("ArrowLeft");await page.getByRole("button",{name:"Delete chat with Alex",exact:true}).click();await page.getByRole("button",{name:"Delete for me",exact:true}).click();await expect(page.locator(".conversation")).toHaveCount(1);
});

test("group leave is reachable directly from the chat menu",async({page})=>{
 const calls=await mock(page);await openChat(page,true);await page.getByRole("button",{name:"Chat menu"}).click();await page.getByRole("button",{name:"Leave group",exact:true}).click();await page.getByRole("dialog",{name:"Leave group?"}).getByRole("button",{name:"Leave group",exact:true}).click();await expect(page.getByRole("textbox",{name:"Search chats"})).toBeVisible();expect(calls.some(c=>c.name==="leave_group")).toBe(true);
});

test("saved square stickers persist locally after a reload and can be removed",async({page})=>{
 await mock(page);await openChat(page);await page.getByRole("button",{name:"Attachments"}).click();await page.getByRole("button",{name:"Sticker",exact:true}).click();await page.getByRole("button",{name:"Create sticker",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Create sticker"});await dialog.getByRole("button",{name:"Save sticker",exact:true}).click();await expect(dialog.getByRole("button",{name:"Sticker saved",exact:true})).toBeDisabled();
 expect(await dialog.locator("canvas").evaluate((node:HTMLCanvasElement)=>[node.width,node.height])).toEqual([512,512]);await dialog.getByRole("button",{name:"Close",exact:true}).click();await expect(page.getByRole("button",{name:"Send saved sticker",exact:true})).toHaveCount(1);
 await page.getByRole("button",{name:"Close",exact:true}).click();await page.reload();await openChat(page);await page.getByRole("button",{name:"Attachments"}).click();await page.getByRole("button",{name:"Sticker",exact:true}).click();await expect(page.getByRole("button",{name:"Send saved sticker",exact:true})).toHaveCount(1);
 await page.getByRole("button",{name:"Manage stickers"}).click();await page.getByRole("button",{name:"Remove saved sticker"}).click();await expect(page.getByRole("button",{name:"Create sticker",exact:true})).toBeVisible();
});

test("Pro password accepts a normal keyboard and submits symbols unchanged",async({page})=>{
 await mock(page);let submitted:unknown;
 await page.route("**/rest/v1/rpc/unlock_pro",route=>{submitted=route.request().postDataJSON();return route.fulfill({status:200,contentType:"application/json",body:"true"});});
 await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Settings",exact:true}).click();const password=page.getByLabel("Pro password",{exact:true});await expect(password).toHaveAttribute("inputmode","text");await password.fill("A-private**password");await page.getByRole("button",{name:"Submit",exact:true}).click();await expect(password).toHaveCount(0);expect(submitted).toEqual({p_code:"A-private**password"});
});

test("notification permission is requested only by an explicit switch tap",async({page})=>{
 await page.addInitScript(()=>{let requests=0;Object.defineProperty(window,"Notification",{configurable:true,value:{permission:"default",requestPermission:async()=>{requests++;return "denied";}}});Object.defineProperty(window,"notificationRequests",{get:()=>requests});});
 await mock(page);expect(await page.evaluate(()=>(window as unknown as {notificationRequests:number}).notificationRequests)).toBe(0);
 await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Notifications",exact:true}).click();await page.getByRole("switch",{name:"Message alerts"}).click();await expect(page.getByRole("dialog",{name:"Notifications"}).getByRole("alert")).toContainText("blocked");expect(await page.evaluate(()=>(window as unknown as {notificationRequests:number}).notificationRequests)).toBe(1);await expect(page.getByRole("switch",{name:"Message alerts"})).toHaveAttribute("aria-checked","false");
});

test("camera starts only when requested and stops on close with flash available",async({page})=>{
 await page.addInitScript(()=>{
  const stats={starts:0,stops:0};Object.assign(window,{cameraStats:stats});
  Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:async()=>{stats.starts++;const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;const ctx=canvas.getContext("2d")!;ctx.fillStyle="#ffd2c8";ctx.fillRect(0,0,320,240);const stream=canvas.captureStream(15);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stats.stops++;stop();};}return stream;}});
 });
 await mock(page);await openChat(page);expect(await page.evaluate(()=>(window as unknown as {cameraStats:{starts:number}}).cameraStats.starts)).toBe(0);
 await page.getByRole("button",{name:"Attachments"}).click();await page.getByRole("button",{name:"Instant",exact:true}).click();await expect(page.getByRole("button",{name:"Take and send one-view photo"})).toBeEnabled();await page.getByRole("button",{name:"Screen flash",exact:true}).click();await expect(page.getByRole("button",{name:"Screen flash",exact:true})).toHaveAttribute("aria-pressed","true");await page.getByRole("button",{name:"Close",exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {cameraStats:{stops:number}}).cameraStats.stops)).toBe(1);
});

test("instant viewer has no image link and wipes canvas pixels on close",async({page})=>{
 await mock(page,true);await page.route("**/functions/v1/open-instant",route=>route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64")}));await openChat(page);await page.locator(".instant-card").first().click();const viewer=page.getByRole("dialog",{name:"Instant",exact:true});await expect(viewer.locator("canvas")).toBeVisible();await expect(viewer.locator("img,a")).toHaveCount(0);await viewer.locator("canvas").evaluate(node=>Object.assign(window,{closedInstantCanvas:node}));await viewer.getByRole("button",{name:"Close",exact:true}).click();expect(await page.evaluate(()=>{const node=(window as unknown as {closedInstantCanvas:HTMLCanvasElement}).closedInstantCanvas;return [node.width,node.height];})).toEqual([0,0]);
});

test("composer preserves new text while an earlier send waits for local storage",async({page})=>{
 await page.addInitScript(()=>{
  const property=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,"oncomplete")!;
  Object.defineProperty(IDBTransaction.prototype,"oncomplete",{...property,set:function(this:IDBTransaction,handler:((event:Event)=>void)|null){
   const shouldDelay=(window as unknown as {delayOutbox?:boolean}).delayOutbox&&this.mode==="readwrite"&&this.objectStoreNames.contains("outbox");
   if(shouldDelay)(window as unknown as {delayOutbox?:boolean}).delayOutbox=false;
   property.set!.call(this,shouldDelay&&handler?function(this:IDBTransaction,event:Event){setTimeout(()=>handler.call(this,event),700);}:handler);
  }});
 });
 await mock(page);await openChat(page);const input=page.getByRole("textbox",{name:"Message",exact:true});await page.evaluate(()=>Object.assign(window,{delayOutbox:true}));await input.fill("First draft");await page.getByRole("button",{name:"Send message",exact:true}).click();await input.fill("Second draft");await expect(page.locator(".message-text").filter({hasText:"First draft"})).toBeVisible();await expect(input).toHaveValue("Second draft");await expect(page.getByRole("button",{name:"Record voice note"})).toHaveCount(0);await input.fill("");await expect(page.getByRole("button",{name:"Record voice note"})).toBeVisible();await expect(page.getByRole("button",{name:"Emoji",exact:true})).toBeVisible();
});


test("received realtime messages show an account-scoped alert and open the chat",async({page})=>{
 await mock(page);let socket:{send:(data:string)=>void}|undefined,topic="",join:string|null=null,ids:number[]=[];
 await page.routeWebSocket("wss://llweydgvtpwgnslvgnqm.supabase.co/**",ws=>ws.onMessage(raw=>{try{
  const message=JSON.parse(String(raw));if(!Array.isArray(message))return;
  const filters=(message[4]?.config?.postgres_changes??[]).map((filter:Record<string,unknown>,index:number)=>({...filter,id:index+1}));
  if(message[3]==="phx_join"&&String(message[2]).includes("inbox:")){socket=ws;topic=message[2];join=message[0];ids=filters.filter((filter:{table:string})=>filter.table==="messages").map((filter:{id:number})=>filter.id);}
  ws.send(JSON.stringify([message[0],message[1],message[2],"phx_reply",{status:"ok",response:{postgres_changes:filters}}]));
 }catch{}}));
 await page.reload();await expect(page.locator(".conversation")).toHaveCount(2);await expect.poll(()=>ids.length).toBe(1);
 const record={...messages[0],id:"abcd1234-1234-4234-8234-123456789abc",created_at:new Date().toISOString()};
 socket!.send(JSON.stringify([join,null,topic,"postgres_changes",{ids,data:{schema:"public",table:"messages",type:"INSERT",record,old_record:{},columns:[],commit_timestamp:new Date().toISOString(),errors:[]}}]));
 await expect(page.locator(".message-toast")).toBeVisible();await page.locator(".message-toast").getByRole("button",{name:"New message",exact:true}).click();await expect(page.locator(".thread-person")).toContainText("Alex");await expect(page.locator(".message-toast")).toHaveCount(0);
});

test("backgrounding releases the camera and resuming requires a fresh tap",async({page})=>{
 await page.addInitScript(()=>{const stats={starts:0,stops:0};Object.assign(window,{cameraStats:stats});Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:async()=>{stats.starts++;const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;canvas.getContext("2d")!.fillRect(0,0,320,240);const media=canvas.captureStream(15);for(const track of media.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stats.stops++;stop();};}return media;}});});
 await mock(page);await openChat(page);await page.getByRole("button",{name:"Attachments"}).click();await page.getByRole("button",{name:"Instant",exact:true}).click();await expect(page.getByRole("button",{name:"Take and send one-view photo"})).toBeEnabled();
 await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});document.dispatchEvent(new Event("visibilitychange"));});await expect(page.getByRole("button",{name:"Resume camera"})).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as unknown as {cameraStats:{stops:number}}).cameraStats.stops)).toBe(1);
 await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});document.dispatchEvent(new Event("visibilitychange"));});expect(await page.evaluate(()=>(window as unknown as {cameraStats:{starts:number}}).cameraStats.starts)).toBe(1);
 await page.getByRole("button",{name:"Resume camera"}).click();await expect(page.getByRole("button",{name:"Take and send one-view photo"})).toBeEnabled();expect(await page.evaluate(()=>(window as unknown as {cameraStats:{starts:number}}).cameraStats.starts)).toBe(2);await page.getByRole("button",{name:"Close",exact:true}).click();
});


test("emoji insertion respects the caret and never splits a draft at its length limit",async({page})=>{
 await mock(page);await openChat(page);const input=page.getByRole("textbox",{name:"Message",exact:true});await input.fill("Hello there");await input.evaluate((node:HTMLTextAreaElement)=>node.setSelectionRange(6,6));await page.getByRole("button",{name:"Emoji",exact:true}).click();await page.locator(".emoji-picker").getByRole("button",{name:"🫶",exact:true}).click();await expect(input).toHaveValue("Hello 🫶there");
 await input.fill("x".repeat(3999));await page.locator(".emoji-picker").getByRole("button",{name:"🫶",exact:true}).click();await expect(input).toHaveValue("x".repeat(3999));
});

test("swipe reveals private chat actions without opening a conversation",async({page},info)=>{
 const calls=await mock(page);const alexRow=page.locator(".conversation").filter({hasText:"Alex"});
 await expect(page.getByRole("button",{name:"Delete chat with Alex",exact:true})).toHaveCount(0);
 await dragChat(page,alexRow,info.project.name==="mobile",-130);
 await expect(page.getByRole("button",{name:"Archive chat with Alex",exact:true})).toBeVisible();await expect(alexRow).toHaveAttribute("aria-expanded","true");
 if(process.env.CI)console.log("SWIPE_"+info.project.name+" "+(await page.screenshot({type:"jpeg",quality:70})).toString("base64"));
 await expect(page.locator(".thread-person")).toHaveCount(0);
 await dragChat(page,page.locator(".conversation").filter({hasText:"Weekend crew"}),info.project.name==="mobile",-130);
 await expect(page.locator(".conversation-item.actions-open")).toHaveCount(1);await expect(alexRow).toHaveAttribute("aria-expanded","false");
 await page.locator(".conversation").filter({hasText:"Weekend crew"}).focus();await page.keyboard.press("Escape");
 await dragChat(page,alexRow,info.project.name==="mobile",-130);await page.getByRole("button",{name:"Delete chat with Alex",exact:true}).click();
 await page.getByRole("button",{name:"Cancel",exact:true}).click();await expect(page.locator(".conversation")).toHaveCount(2);expect(calls.some(c=>c.name==="clear_chat")).toBe(false);
});

test("archive survives reload and unarchive preserves messages",async({page},info)=>{
 const calls=await mock(page);await dragChat(page,page.locator(".conversation").filter({hasText:"Alex"}),info.project.name==="mobile",-130);
 await page.getByRole("button",{name:"Archive chat with Alex",exact:true}).click();await expect(page.locator(".conversation")).toHaveCount(1);
 await expect(page.locator(".recent-people").getByRole("button",{name:"Open chat with Alex"})).toHaveCount(0);
 expect(calls.find(c=>c.name==="set_chat_archived")?.body).toEqual({p_conversation:cid,p_archived:true});expect(calls.some(c=>c.name==="clear_chat")).toBe(false);
 await page.reload();await expect(page.locator(".conversation")).toHaveCount(1);await page.getByRole("button",{name:"Archived",exact:true}).click();
 await expect(page.locator(".conversation").filter({hasText:"Alex"})).toBeVisible();await dragChat(page,page.locator(".conversation").filter({hasText:"Alex"}),info.project.name==="mobile",-130);
 await page.getByRole("button",{name:"Unarchive chat with Alex",exact:true}).click();await expect(page.getByText("No archived chats",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"All",exact:true}).click();await expect(page.locator(".conversation")).toHaveCount(2);await openChat(page);await expect(page.locator(".message-text")).toHaveCount(2);
 expect(calls.filter(c=>c.name==="set_chat_archived").map(c=>c.body.p_archived)).toEqual([true,false]);
});

test("vertical gestures keep swipe actions hidden and never open a chat",async({page},info)=>{
 await mock(page);const row=page.locator(".conversation").filter({hasText:"Alex"});await dragChat(page,row,info.project.name==="mobile",8,58);
 await expect(row).toHaveAttribute("aria-expanded","false");await expect(page.locator(".conversation-item.actions-open")).toHaveCount(0);await expect(page.locator(".thread-person")).toHaveCount(0);
});

test("failed archive leaves the row and its history untouched",async({page})=>{
 await mock(page);await page.route("**/rest/v1/rpc/set_chat_archived",route=>route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({message:"Conversation unavailable."})}));
 const row=page.locator(".conversation").filter({hasText:"Alex"});await row.focus();await page.keyboard.press("ArrowLeft");await page.getByRole("button",{name:"Archive chat with Alex",exact:true}).click();
 await expect(page.locator(".conversation-list").getByRole("alert")).toHaveText("Conversation unavailable.");await expect(page.locator(".conversation")).toHaveCount(2);await expect(row).toHaveAttribute("aria-expanded","true");
 await page.keyboard.press("Escape");await expect(row).toHaveAttribute("aria-expanded","false");await row.click();await expect(page.locator(".message-text")).toHaveCount(2);
});

test("received stickers have a visible save action and enter the local square collection",async({page})=>{
 await mock(page);const path=other+"/"+cid+"/received.png",png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64");
 await page.route("**/rest/v1/messages?**",route=>route.request().method()==="GET"?route.fulfill({status:200,contentType:"application/json",body:JSON.stringify([...messages,{...messages[0],id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",content:"",kind:"sticker",media_kind:"image",media_url:path}])}):route.fallback());
 await page.route("**/storage/v1/**",route=>route.request().method()==="POST"?route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({signedURL:"/object/sign/chat-media/"+path+"?token=test"})}):route.fulfill({status:200,contentType:"image/png",body:png}));
 await openChat(page);const save=page.getByRole("button",{name:"Save sticker",exact:true});await expect(save).toBeVisible();await save.click();await expect(page.getByRole("button",{name:"Sticker saved",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Attachments"}).click();await page.getByRole("button",{name:"Sticker",exact:true}).click();const tile=page.getByRole("button",{name:"Send saved sticker",exact:true});await expect(tile).toHaveCount(1);
 await expect.poll(()=>tile.locator("img").evaluate((img:HTMLImageElement)=>[img.naturalWidth,img.naturalHeight])).toEqual([512,512]);
});

test("one-view pixels clear synchronously on backgrounding and cannot reopen",async({page})=>{
 await mock(page,true);let opens=0;await page.route("**/functions/v1/open-instant",route=>{opens++;return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64")});});
 await openChat(page);await page.locator(".instant-card").first().click();await expect.poll(()=>page.getByRole("img",{name:"One-view photo"}).evaluate((node:HTMLCanvasElement)=>node.width)).toBe(1);
 expect(await page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>(".instant-photo")!;Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));return[canvas.width,canvas.height];})).toEqual([0,0]);
 await expect(page.getByRole("dialog",{name:"Instant",exact:true})).toHaveCount(0);await expect(page.locator(".instant-card").first()).toBeDisabled();expect(opens).toBe(1);
});

test("a delayed one-view decode never redraws pixels after focus loss",async({page})=>{
 await page.addInitScript(()=>{const original=createImageBitmap;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});Object.assign(window,{releasePhoto:release});Object.defineProperty(window,"createImageBitmap",{configurable:true,value:async(...args:Parameters<typeof createImageBitmap>)=>{const bitmap=await original(...args);await gate;Object.assign(window,{dismissedBitmap:bitmap});return bitmap;}});});
 await mock(page,true);await page.route("**/functions/v1/open-instant",route=>route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64")}));await openChat(page);await page.locator(".instant-card").first().click();
 await page.getByRole("img",{name:"One-view photo"}).evaluate(node=>Object.assign(window,{dismissedCanvas:node}));await page.evaluate(()=>window.dispatchEvent(new Event("blur")));await expect(page.getByRole("dialog",{name:"Instant",exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as unknown as {releasePhoto:()=>void}).releasePhoto());await expect.poll(()=>page.evaluate(()=>(window as unknown as {dismissedBitmap?:ImageBitmap}).dismissedBitmap?.width)).toBe(0);
 expect(await page.evaluate(()=>{const canvas=(window as unknown as {dismissedCanvas:HTMLCanvasElement}).dismissedCanvas;return[canvas.width,canvas.height];})).toEqual([0,0]);
});

test("damaged one-view bytes show an error without blank pixels or a crash",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await mock(page,true);
 await page.route("**/functions/v1/open-instant",route=>route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N9sAAAAASUVORK5CYII=","base64")}));
 await openChat(page);await page.locator(".instant-card").first().click();const viewer=page.getByRole("dialog",{name:"Instant",exact:true});await expect(viewer.getByRole("alert")).toBeVisible();expect(await viewer.locator("canvas").evaluate((node:HTMLCanvasElement)=>[node.width,node.height])).toEqual([0,0]);
 await viewer.getByRole("button",{name:"Close",exact:true}).click();await expect(page.locator(".instant-card").first()).toBeDisabled();expect(errors).toEqual([]);
});

test("old inbox responses cannot undo archiving and newer device changes still apply",async({page})=>{
 await mock(page);let reads=0,releaseOld!:()=>void,releaseNew!:()=>void;
 const old=new Promise<void>(resolve=>{releaseOld=resolve;}),fresh=new Promise<void>(resolve=>{releaseNew=resolve;});
 await page.route("**/rest/v1/rpc/inbox_page",async route=>{reads++;if(reads===1)await old;else if(reads===2)await fresh;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify([{...direct,archived:false},group])});});
 await page.evaluate(()=>window.dispatchEvent(new Event("online")));await expect.poll(()=>reads).toBe(1);
 const row=page.locator(".conversation").filter({hasText:"Alex"});await row.focus();await page.keyboard.press("ArrowLeft");await page.getByRole("button",{name:"Archive chat with Alex",exact:true}).click();await expect(page.locator(".conversation")).toHaveCount(1);
 releaseOld();await expect.poll(()=>reads).toBe(2);await expect(page.locator(".conversation")).toHaveCount(1);
 releaseNew();await expect(page.locator(".conversation")).toHaveCount(2);await expect(page.locator(".conversation").filter({hasText:"Alex"})).toBeVisible();
});


test("affection sends kisses and hugs without disturbing a reply or a typed draft",async({page})=>{
 const calls=await mock(page);await openChat(page);const input=page.getByRole("textbox",{name:"Message",exact:true});await input.fill("Keep this thought");
 for(const kind of ["kiss","hug"]){await page.getByRole("button",{name:"Attachments",exact:true}).click();await page.getByRole("button",{name:"Affection",exact:true}).click();await page.getByRole("button",{name:"Send "+kind,exact:true}).click();await expect(input).toHaveValue("Keep this thought");await expect(page.locator(".affection-tray")).toHaveCount(0);}
 await expect(page.locator(".affection-caption").filter({hasText:"A kiss for you"})).toBeVisible();await expect(page.locator(".affection-caption").filter({hasText:"A hug for you"})).toBeVisible();
 await expect.poll(()=>calls.filter(c=>c.name==="messages"&&String(c.body.content).includes("for you")).length).toBe(2);
 await page.getByRole("button",{name:"I miss you",exact:true}).click();await expect(page.locator(".affection-caption").filter({hasText:"I miss you"})).toBeVisible();await expect(input).toHaveValue("Keep this thought");
 await expect.poll(()=>calls.some(c=>c.name==="messages"&&c.body.kind==="miss"&&c.body.content==="🤍 I miss you")).toBe(true);
});
test("swipe to reply works in both directions of authorship and keeps a typed draft",async({page},info)=>{
 const calls=await mock(page);await openChat(page);const input=page.getByRole("textbox",{name:"Message",exact:true});await input.fill("Yes please");
 await dragChat(page,page.locator(".message-row").first().locator(".bubble"),info.project.name==="mobile",112);
 await expect(page.locator(".composer-reply")).toContainText("Coffee after work?");await expect(input).toBeFocused();await expect(input).toHaveValue("Yes please");await expect(page.getByRole("dialog",{name:"Message",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Cancel reply",exact:true}).click();
 await dragChat(page,page.locator(".message-row.own").last().locator(".bubble"),info.project.name==="mobile",112);
 await expect(page.locator(".composer-reply")).toContainText("Absolutely");await expect(page.locator(".composer-reply")).toContainText("yourself");
 await page.getByRole("button",{name:"Send message",exact:true}).click();await expect.poll(()=>calls.some(c=>c.name==="messages"&&c.body.reply_to===messages[1].id&&c.body.content==="Yes please")).toBe(true);
});
test("vertical, cancelled and short drags do not select a reply or open a menu",async({page},info)=>{
 await mock(page);await openChat(page);const bubble=page.locator(".message-row").first().locator(".bubble"),mobile=info.project.name==="mobile";
 await dragChat(page,bubble,mobile,8,58);await dragChat(page,bubble,mobile,40);
 await bubble.dispatchEvent("pointerdown",{pointerId:99,clientX:30,clientY:30,isPrimary:true,button:0});await bubble.dispatchEvent("pointercancel",{pointerId:99});
 await expect(page.locator(".composer-reply")).toHaveCount(0);await expect(page.getByRole("dialog",{name:"Message",exact:true})).toHaveCount(0);
 expect(await bubble.evaluate(node=>node.style.transform)).toBe("");
});
test("one-view pixels disappear on the next touch and the photo cannot be reopened",async({page})=>{
 await mock(page,true);let opens=0;await page.route("**/functions/v1/open-instant",route=>{opens++;return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64")});});
 await openChat(page);await page.locator(".instant-card").first().click();const viewer=page.getByRole("dialog",{name:"Instant",exact:true});await expect.poll(()=>viewer.locator("canvas").evaluate((node:HTMLCanvasElement)=>node.width)).toBe(1);
 await viewer.locator("canvas").evaluate(node=>Object.assign(window,{touchedPhoto:node}));await viewer.locator("canvas").click();await expect(viewer).toHaveCount(0);await expect(page.locator(".instant-card").first()).toBeDisabled();
 expect(await page.evaluate(()=>{const node=(window as unknown as {touchedPhoto:HTMLCanvasElement}).touchedPhoto;return[node.width,node.height];})).toEqual([0,0]);expect(opens).toBe(1);
});
test("exposed screenshot keys close an instant while opted-in replay photos retain their save control",async({page})=>{
 await mock(page,true);await page.route("**/functions/v1/open-instant",route=>route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64")}));
 await openChat(page);await page.locator(".instant-card").first().click();await expect(page.getByRole("dialog",{name:"Instant",exact:true})).toBeVisible();await page.keyboard.press("PrintScreen");await expect(page.getByRole("dialog",{name:"Instant",exact:true})).toHaveCount(0);
 await page.locator(".instant-card").nth(1).click();const replay=page.getByRole("dialog",{name:"Replayable photo",exact:true});await expect(replay.getByRole("button",{name:"Save photo",exact:true})).toBeVisible();await replay.locator("canvas").click();await expect(replay).toBeVisible();await replay.getByRole("button",{name:"Close",exact:true}).click();
});
test("couple mode gives a romantic accent and a date picker inside Play",async({page},info)=>{
 const calls=await mock(page,false,true,true);await openChat(page);await expect(page.locator(".chat-thread")).toHaveClass(/romantic-chat/);
 await page.getByRole("button",{name:"I miss you",exact:true}).click();await expect(page.locator(".affection-caption")).toContainText("I miss you");
 if(info.project.name==="mobile")console.log("ROMANTIC_MOBILE "+(await page.screenshot({type:"jpeg",quality:80})).toString("base64"));
 await page.locator(".chat-shortcuts").getByRole("button",{name:"Play",exact:true}).click();await page.getByRole("button",{name:"Pick our date",exact:true}).click();await expect.poll(()=>calls.some(c=>c.name==="messages"&&String(c.body.content).startsWith("💌 "))).toBe(true);
});
async function pushDevice(page:Page){
 await page.addInitScript(()=>{
  let permission="default",subscription:Record<string,unknown>|null=null;const stats={requests:0,subscribed:0,unsubscribed:0};Object.assign(window,{pushStats:stats});
  const reg={active:{},getNotifications:async()=>[],pushManager:{getSubscription:async()=>subscription,subscribe:async(options:{applicationServerKey:Uint8Array})=>{stats.subscribed++;const record={endpoint:"https://fcm.googleapis.com/fcm/send/test-device",options:{applicationServerKey:options.applicationServerKey.buffer},toJSON:()=>({keys:{p256dh:"B"+"A".repeat(86),auth:"A".repeat(22)}}),unsubscribe:async()=>{stats.unsubscribed++;subscription=null;return true;}};subscription=record;return record;}}};
  Object.defineProperty(window,"Notification",{configurable:true,value:{get permission(){return permission;},requestPermission:async()=>{stats.requests++;permission="granted";return permission;}}});Object.defineProperty(window,"PushManager",{configurable:true,value:function(){}});
  Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{ready:Promise.resolve(reg),getRegistration:async()=>reg,register:async()=>reg,addEventListener:()=>{},removeEventListener:()=>{}}});
 });
}
test("push opt-in registers one device and disabling removes it without another permission prompt",async({page})=>{
 await pushDevice(page);const calls=await mock(page);expect(await page.evaluate(()=>(window as unknown as {pushStats:{requests:number}}).pushStats.requests)).toBe(0);
 await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Notifications",exact:true}).click();const toggle=page.getByRole("switch",{name:"Message alerts",exact:true});await toggle.click();await expect(toggle).toHaveAttribute("aria-checked","true");
 expect(calls.find(c=>c.name==="register_push_subscription")?.body).toEqual({p_endpoint:"https://fcm.googleapis.com/fcm/send/test-device",p_p256dh:"B"+"A".repeat(86),p_auth:"A".repeat(22)});
 await toggle.click();await expect(toggle).toHaveAttribute("aria-checked","false");await expect.poll(()=>calls.filter(c=>c.name==="unregister_push_subscription").length).toBe(1);
 expect(await page.evaluate(()=>(window as unknown as {pushStats:unknown}).pushStats)).toEqual({requests:1,subscribed:1,unsubscribed:1});
});
test("a failed push registration rolls back the subscription and keeps the chat usable",async({page})=>{
 await pushDevice(page);await mock(page);await page.route("**/rest/v1/rpc/register_push_subscription",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Connection lost. Try again."})}));
 await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Notifications",exact:true}).click();await page.getByRole("switch",{name:"Message alerts",exact:true}).click();await expect(page.getByRole("dialog",{name:"Notifications",exact:true}).getByRole("alert")).toBeVisible();await expect(page.getByRole("switch",{name:"Message alerts",exact:true})).toHaveAttribute("aria-checked","false");
 expect(await page.evaluate(()=>(window as unknown as {pushStats:{unsubscribed:number}}).pushStats.unsubscribed)).toBe(1);
 await page.getByRole("dialog",{name:"Notifications",exact:true}).getByRole("button",{name:"Close",exact:true}).click();await page.getByRole("dialog",{name:"Profile",exact:true}).getByRole("button",{name:"Close",exact:true}).click();await openChat(page);await page.getByRole("textbox",{name:"Message",exact:true}).fill("Still works");await page.getByRole("button",{name:"Send message",exact:true}).click();await expect(page.locator(".message-text").filter({hasText:"Still works"})).toBeVisible();
});
