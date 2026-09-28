import { test, expect, type Page } from "@playwright/test";
const uid="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",third="55555555-5555-4555-8555-555555555555";
const cid="33333333-3333-4333-8333-333333333333",gid="66666666-6666-4666-8666-666666666666";
const stamp=new Date(Date.now()-60000).toISOString(),code="abcdef0123456789abcdef0123456789";
const self={id:uid,username:"sam",display_name:"Sam",avatar_url:null,mood:"😊",is_pro:true};
const alex={...self,id:other,username:"alex",display_name:"Alex",mood:"🫶",is_pro:false};
const maya={...alex,id:third,username:"maya",display_name:"Maya",mood:null};
const direct={id:cid,kind:"direct",title:"",member_a:uid,member_b:other,created_by:uid,created_at:stamp,last_activity:stamp,read_a:stamp,read_b:stamp,couple_a:false,couple_b:false,members:[self,alex],preview:"See you soon ✨",read_at:stamp};
const group={...direct,id:gid,kind:"group",title:"Weekend crew",member_a:null,member_b:null,members:[self,alex,maya],preview:"Saturday sounds perfect",member_reads:[{user_id:other,read_at:stamp}]};
const messages=[{id:"77777777-7777-4777-8777-777777777777",conversation_id:cid,user_id:other,content:"Coffee after work? ☕",media_url:null,media_kind:null,kind:"message",instant_viewed:false,created_at:new Date(Date.now()-120000).toISOString()},{id:"88888888-8888-4888-8888-888888888888",conversation_id:cid,user_id:uid,content:"Absolutely. Same place, 6:30?",media_url:null,media_kind:null,kind:"message",instant_viewed:false,created_at:stamp}];
async function mock(page:Page,instants=false){
 const calls:{name:string;body:Record<string,unknown>}[]=[];let hidden=false,left=false;let privacy={share_online:true,share_last_active:true,share_typing:true,share_receipts:true};
 await page.addInitScript(({uid})=>{const token=btoa(JSON.stringify({alg:"HS256"}))+"."+btoa(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600,aud:"authenticated",role:"authenticated"}))+".test";localStorage.setItem("sb-llweydgvtpwgnslvgnqm-auth-token",JSON.stringify({access_token:token,refresh_token:"test",expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:"bearer",user:{id:uid,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{}}}));},{uid});
 await page.route("**/rest/v1/**",async route=>{
  const url=new URL(route.request().url()),name=url.pathname.split("/").at(-1)!;const bodyIn=route.request().postDataJSON()??{};let body:unknown=[];
  if(route.request().method()==="POST")calls.push({name,body:bodyIn});
  if(name==="my_privacy")body=privacy;
  if(name==="set_privacy"){privacy={share_online:!!bodyIn.p_online,share_last_active:!!bodyIn.p_last_active,share_typing:!!bodyIn.p_typing,share_receipts:!!bodyIn.p_receipts};body=privacy;}
  if(name==="member_activity")body=[{user_id:other,online:false,last_active:new Date(Date.now()-7260000).toISOString()}];
  if(name==="profiles")body=url.searchParams.get("id")?.startsWith("in.")?[self,alex,maya]:self;
  if(name==="inbox_page")body=[...(!hidden?[direct]:[]),...(!left?[group]:[])];
  if(name==="conversations")body=url.searchParams.get("id")?.includes(gid)?group:direct;
  if(name==="conversation_members")body=[self,alex,maya].map(p=>({user_id:p.id,last_read_at:stamp}));
  if(name==="messages")body=messages.map(m=>({...m,conversation_id:url.searchParams.get("conversation_id")?.includes(gid)?gid:cid}));
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
 await page.route("**/functions/v1/open-instant",route=>{opens++;return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N9sAAAAASUVORK5CYII=","base64")});});
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
 expect(calls.filter(c=>c.name==="set_privacy").at(-1)?.body).toEqual({p_online:false,p_last_active:false,p_typing:false,p_receipts:false});
 await modal.getByRole("button",{name:"Close",exact:true}).click();await page.getByRole("dialog",{name:"Profile",exact:true}).getByRole("button",{name:"Close",exact:true}).click();await openChat(page);
 await expect(page.locator(".thread-person")).toContainText("Active 2h ago");await page.getByRole("textbox",{name:"Message",exact:true}).fill("A private draft");expect(calls.filter(c=>c.name==="send_typing")).toHaveLength(0);
 if(await page.getByRole("button",{name:"Back to messages"}).isVisible())await page.getByRole("button",{name:"Back to messages"}).click();
 await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Privacy",exact:true}).click();await expect(page.getByRole("switch",{name:"Typing indicator"})).toHaveAttribute("aria-checked","false");
});
test("message controls use icons and expose editing only on owned messages",async({page})=>{
 await mock(page);await openChat(page);const own=page.locator(".message-row.own");await expect(own.getByRole("button",{name:"Message actions"}).locator("svg")).toHaveCount(1);await own.getByRole("button",{name:"Message actions"}).click();await page.getByRole("button",{name:"Edit",exact:true}).click();await expect(page.getByRole("dialog",{name:"Edit message"})).toBeVisible();await page.getByRole("button",{name:"Close",exact:true}).click();
 await page.locator(".message-row:not(.own)").getByRole("button",{name:"Message actions"}).click();await expect(page.getByRole("button",{name:"Edit",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Delete for everyone",exact:true})).toHaveCount(0);
});
