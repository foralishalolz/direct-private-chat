
import {test,expect,type Page} from "@playwright/test";
test("login is responsive, accessible and free of runtime errors",async({page})=>{const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("/");await expect(page.getByRole("textbox",{name:"Username"})).toBeVisible();await expect(page.getByRole("button",{name:"Log in",exact:true})).toBeVisible();await expect(page.getByText("BitchAt.")).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole("tab",{name:"Create account"}).click();await expect(page.getByRole("button",{name:"Create account",exact:true})).toBeVisible();await page.getByRole("button",{name:"Show password"}).click();await expect(page.getByRole("textbox",{name:"Password"})).toHaveAttribute("type","text");expect(errors).toEqual([]);});
test("invalid login reports the real error without crashing",async({page})=>{await page.route("**/auth/v1/token?grant_type=password",route=>route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"invalid_grant",error_description:"Invalid login credentials",msg:"Invalid login credentials"})}));await page.goto("/");await page.getByRole("textbox",{name:"Username"}).fill("test_person");await page.locator('input[aria-label="Password"]').fill("incorrect-password");await page.getByRole("button",{name:"Log in",exact:true}).click();await expect(page.locator("p.error[role=alert]")).toContainText("Username or password is incorrect");await expect(page.getByRole("button",{name:"Log in",exact:true})).toBeEnabled();});
test("login route works on a direct navigation",async({page})=>{await page.goto("/login/");await expect(page.getByRole("textbox",{name:"Username"})).toBeVisible();});
const uid="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",cid="33333333-3333-4333-8333-333333333333";
const profile={id:uid,username:"sample_user",display_name:"Sam",avatar_url:null,mood:"🥰",is_pro:true},partner={...profile,id:other,username:"alex",display_name:"Alex",is_pro:false};
async function signedIn(page:Page,couple=false){
 await page.addInitScript(({uid,profile})=>{const header=btoa(JSON.stringify({alg:"HS256",typ:"JWT"})),payload=btoa(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600,role:"authenticated",aud:"authenticated"}));localStorage.setItem("sb-llweydgvtpwgnslvgnqm-auth-token",JSON.stringify({access_token:header+"."+payload+".test",refresh_token:"test-refresh",expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:"bearer",user:{id:uid,aud:"authenticated",role:"authenticated",email:"sample_user@chat.local",app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}));},{uid,profile});
 await page.route("**/rest/v1/**",async route=>{const url=new URL(route.request().url()),path=url.pathname;let body:unknown=[];
 if(path.endsWith("/profiles"))body=url.searchParams.get("id")?.startsWith("in.")?[profile,partner]:profile;
 if(path.endsWith("/rpc/inbox_page"))body=[{id:cid,kind:"direct",title:"",member_a:uid,member_b:other,last_activity:"2026-09-14T10:00:00Z",created_at:"2026-09-14T09:00:00Z",read_a:null,read_b:null,couple_a:couple,couple_b:couple,members:[profile,partner],preview:"Hello",read_at:null}];
 if(path.endsWith("/messages")){if(route.request().method()==="POST"){const sent=route.request().postDataJSON();body={...sent,created_at:new Date().toISOString(),instant_viewed:false};}else body=[{id:"44444444-4444-4444-8444-444444444444",conversation_id:cid,user_id:other,content:"Hello",media_url:null,media_kind:null,kind:"message",instant_viewed:false,created_at:"2026-09-14T10:00:00Z"}];}
 if(path.endsWith("/rpc/my_privacy"))body={revision:0,share_online:true,share_last_active:true,share_typing:true,share_receipts:true};
 if(path.endsWith("/rpc/my_blocks"))body=[];if(path.endsWith("/rpc/mark_read"))body=null;
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});});
 await page.routeWebSocket("wss://llweydgvtpwgnslvgnqm.supabase.co/**",ws=>{ws.onMessage(raw=>{try{const msg=JSON.parse(String(raw));if(Array.isArray(msg))ws.send(JSON.stringify([msg[0],msg[1],msg[2],"phx_reply",{status:"ok",response:{postgres_changes:[]}}]));}catch{}});});
}
test("inbox opens a chat, sends text, and shows message actions",async({page})=>{const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await signedIn(page);await page.goto("/");await page.getByRole("button",{name:/Alex.*Hello/}).click();await expect(page.getByRole("textbox",{name:"Message",exact:true})).toBeVisible();await expect(page.locator(".message-text").filter({hasText:"Hello"})).toBeVisible();await page.getByRole("textbox",{name:"Message",exact:true}).fill("A real draft");await page.getByRole("button",{name:"Send message",exact:true}).click();await expect(page.locator(".message-text").filter({hasText:"A real draft"})).toBeVisible();await page.getByRole("button",{name:"Message actions"}).last().click();await expect(page.getByRole("button",{name:"Reply",exact:true})).toBeVisible();await page.keyboard.press("Escape");expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);});
test("profile and journal dialogs close without breaking navigation",async({page})=>{await signedIn(page);await page.goto("/");await page.getByRole("button",{name:"Profile",exact:true}).last().click();await page.getByRole("button",{name:"Journal",exact:true}).click();await expect(page.getByRole("dialog",{name:"Journal"})).toBeVisible();await page.getByRole("textbox",{name:"Journal entry"}).fill("Private draft");await page.getByRole("button",{name:"Close",exact:true}).click();await expect(page.getByRole("dialog",{name:"Journal"})).toHaveCount(0);await expect(page.getByRole("button",{name:/Alex.*Hello/})).toBeVisible();});
test("shared pet and future names work within the phone viewport",async({page})=>{
 await signedIn(page,true);
 let pet:{name:string;species:string;feeds:number;plays:number;cuddles:number;last_action:string}|null=null;
 let names:{id:string;name:string}[]=[];
 await page.route("**/rest/v1/**",async(route)=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/couple_pet')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(pet)});
   if(path.endsWith('/future_names')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(names)});
   if(path.endsWith('/rpc/care_couple_pet')) {const a=route.request().postDataJSON();if(a.p_action==='adopt') pet={name:a.p_name,species:a.p_species,feeds:0,plays:0,cuddles:0,last_action:'adopt'};else if(pet && a.p_action==='feed') pet={...pet,feeds:pet.feeds+1,last_action:'feed'};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(pet)});}
   if(path.endsWith('/rpc/change_future_name')) {const a=route.request().postDataJSON();if(a.p_remove) names=names.filter(n=>n.id!==a.p_remove);else names.push({id:'name-1',name:a.p_name});return route.fulfill({status:200,contentType:'application/json',body:'null'});}
   await route.fallback();
 });
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Play',exact:true}).first().click();
 await page.getByRole('textbox',{name:'Add a name'}).fill('Robin');await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.locator('.name-list')).toContainText('Robin');
 await page.getByRole('button',{name:/Our pet/}).click();await page.getByRole('textbox',{name:'Pet name'}).fill('Mochi');await page.getByRole('button',{name:'Adopt'}).click();await expect(page.getByRole('heading',{name:'Mochi'})).toBeVisible();await page.getByRole('button',{name:/Feed/}).click();await expect(page.getByText('1/10 ✨')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("friend chats keep games but hide couple-only features",async({page})=>{
 await signedIn(page);await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();
 await expect(page.getByRole('button',{name:'Makeout',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Reels',exact:true})).toHaveCount(0);
 await page.locator('.chat-shortcuts').getByRole('button',{name:'Play',exact:true}).click();
 await expect(page.getByRole('button',{name:/Live games/})).toBeVisible();
 await expect(page.getByRole('button',{name:/Our pet/})).toHaveCount(0);
 await expect(page.getByText('Names we love')).toHaveCount(0);
});
test("live four in a row starts and submits a column",async({page})=>{
 await signedIn(page);
 let game:{round_id:string;mode:string;board:string;next_player:string;winner:null;finished:boolean;ready_a:boolean;ready_b:boolean;ready_at:null}|null=null;
 await page.route('**/rest/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/live_arcade'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(game)});
  if(path.endsWith('/rpc/start_live_arcade')){game={round_id:'round',mode:'four',board:'-'.repeat(42),next_player:uid,winner:null,finished:false,ready_a:false,ready_b:false,ready_at:null};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(game)});}
  if(path.endsWith('/rpc/play_live_arcade')){if(game){game.board=game.board.slice(0,35)+'A'+game.board.slice(36);game.next_player=other;}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(game)});}
  return route.fallback();
 });
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.locator('.chat-shortcuts').getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:/Live games/}).click();await page.getByRole('button',{name:/Four in a row/}).click();await page.getByRole('button',{name:'Drop in column 1'}).click();await expect(page.getByText('Alex’s turn')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("stories disclose their audience and post text",async({page})=>{
 await signedIn(page);let stories:unknown[]=[];
 await page.route('**/rest/v1/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/rpc/story_feed'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stories)});if(path.endsWith('/rpc/post_story')){const input=route.request().postDataJSON();stories=[{id:'story-1',user_id:uid,body:input.p_body,media_path:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),profiles:profile}];return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stories[0])});}return route.fallback();});
 page.on('dialog',dialog=>dialog.accept());await page.goto('/');await page.getByRole('button',{name:'Your story'}).click();await expect(page.getByText('Visible to all signed-in users for 24 hours.')).toBeVisible();await page.getByRole('textbox',{name:'Story text'}).fill('A moment');await page.getByRole('button',{name:'Post story'}).click();await page.locator('.story-person').filter({hasText:'You'}).click();await expect(page.locator('.story-canvas')).toContainText('A moment');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("journal is available from the chat menu",async({page})=>{await signedIn(page);await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Chat menu'}).click();await page.getByRole('button',{name:'Journal',exact:true}).click();await expect(page.getByRole('dialog',{name:'Journal'})).toBeVisible();});
test("couple reels share a link and load only after a tap",async({page})=>{
 await signedIn(page,true);let reels:{id:string;url:string;added_by:string;created_at:string}[]=[];
 await page.route('**/rest/v1/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/couple_reels'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reels)});if(path.endsWith('/rpc/add_couple_reel')){const args=route.request().postDataJSON();const row={id:'reel-1',url:args.p_url,added_by:uid,created_at:new Date().toISOString()};reels=[row,...reels];return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(row)});}return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Reels',exact:true}).click();await page.getByRole('button',{name:'Add link'}).click();await page.getByLabel('Paste a site, video or Instagram reel link').fill('https://example.com/');await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.getByRole('button',{name:'Load embedded site'})).toBeVisible();await expect(page.locator('iframe.reel-frame')).toHaveCount(0);await page.getByRole('button',{name:'Load embedded site'}).click();await expect(page.locator('iframe.reel-frame')).toHaveAttribute('sandbox','allow-scripts allow-forms allow-presentation');await expect(page.locator('iframe.reel-frame')).toHaveAttribute('src','https://example.com/');
});

test("new message starts with search, not suggestions",async({page})=>{
 await signedIn(page,true);let suggestions=0;
 await page.route('**/rest/v1/rpc/suggested_profiles',async route=>{suggestions++;await route.fulfill({status:200,contentType:'application/json',body:'[]'});});
 await page.goto('/');await page.locator('.inbox-header').getByRole('button',{name:'New message'}).click();await expect(page.getByText('Suggested for you')).toHaveCount(0);await expect(page.getByLabel('Search people')).toBeVisible();expect(suggestions).toBe(0);
});

test("chat links can be added to a couple shared collection",async({page})=>{
 await signedIn(page,true);await page.route('**/rest/v1/messages*',async route=>{if(route.request().method()!=='GET')return route.fallback();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'44444444-4444-4444-8444-444444444444',conversation_id:cid,user_id:other,content:'Watch https://www.instagram.com/reel/Abc123/',media_url:null,media_kind:null,kind:'message',instant_viewed:false,created_at:new Date().toISOString()}])});});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await expect(page.locator('.message-text a')).toHaveAttribute('href','https://www.instagram.com/reel/Abc123/');await page.getByRole('button',{name:'Add link to shared sites'}).click();await expect(page.getByLabel('Paste a site, video or Instagram reel link')).toHaveValue('https://www.instagram.com/reel/Abc123/');
});
test("uploaded photos open in a full-screen viewer",async({page})=>{
 await signedIn(page);await page.route('**/rest/v1/messages*',async route=>{if(route.request().method()!=='GET')return route.fallback();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'44444444-4444-4444-8444-444444444444',conversation_id:cid,user_id:other,content:'',media_url:other+'/'+cid+'/photo.png',media_kind:'image',kind:'message',instant_viewed:false,created_at:new Date().toISOString()}])});});
 await page.route('**/storage/v1/object/sign/chat-media/**',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signedURL:'/object/sign/chat-media/photo.png?token=test'})}));await page.route('**/storage/v1/object/sign/chat-media/photo.png?*',async route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZkAAAAASUVORK5CYII=','base64')}));
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'View photo full screen'}).click();await expect(page.getByRole('dialog',{name:'Photo'})).toBeVisible();await expect(page.getByRole('img',{name:'Full size photo'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Photo'})).toHaveCount(0);
});
test("attachment link tool preserves the draft and validates links",async({page})=>{
 await signedIn(page);await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('Listen to this');await page.getByRole('button',{name:'Attachments'}).click();await page.getByRole('button',{name:'Link',exact:true}).click();await page.getByLabel('Website, reel, video or music link').fill('https://open.spotify.com/track/abc123');await page.getByRole('button',{name:'Add to message'}).click();await expect(message).toHaveValue('Listen to this https://open.spotify.com/track/abc123');
});
test("shared drawing uses a full-screen canvas and sends stroke edits",async({page})=>{
 await signedIn(page);let writes=0, brush="";
 await page.route('**/rest/v1/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/drawing_board'))return route.fulfill({status:200,contentType:'application/json',body:'null'});if(path.endsWith('/rpc/edit_board')){writes++;const data=route.request().postDataJSON();brush=data.p_upserts[0]?.brush ?? brush;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({strokes:data.p_upserts,updated_at:new Date().toISOString()})});}return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Draw together',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Draw together'});await expect(dialog).toHaveClass(/full/);const canvas=dialog.getByLabel('Shared drawing canvas');await expect(canvas).toBeVisible();await expect(dialog.locator('.board-status')).toContainText('Shared live');await dialog.getByRole('button',{name:'Glow pen'}).click();await expect(dialog.getByRole('button',{name:'Glow pen'})).toHaveAttribute('aria-pressed','true');const rect=await canvas.boundingBox();if(!rect)throw new Error('Canvas has no bounds');await page.mouse.move(rect.x+30,rect.y+30);await page.mouse.down();await page.mouse.move(rect.x+80,rect.y+70,{steps:5});await page.mouse.up();await expect.poll(()=>writes).toBeGreaterThan(0);expect(brush).toBe('glow');
});
test("recent missed calls appear in the chat with a callback action",async({page})=>{
 await signedIn(page);await page.route('**/rest/v1/rpc/call_history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'99999999-9999-4999-8999-999999999999',conversation_id:cid,caller:other,callee:uid,kind:'audio',status:'missed',started_at:'2026-09-14T10:01:00Z',answered_at:null,ended_at:'2026-09-14T10:02:00Z',seconds:0}])}));
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await expect(page.getByText('Missed voice call')).toBeVisible();await expect(page.getByRole('button',{name:'Call back'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("audio session shares selected uploaded audio",async({page})=>{
 await signedIn(page);let session:{message_id:string;playing:boolean;position:number;changed_at:string}|null=null;let starts=0;
 const track={id:'88888888-8888-4888-8888-888888888888',media_url:other+'/'+cid+'/song.mp3',content:'Our song',created_at:new Date().toISOString()};
 await page.route('**/rest/v1/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;if(path.endsWith('/messages')&&url.searchParams.get('media_kind')==='eq.audio')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([track])});if(path.endsWith('/shared_listening'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)});if(path.endsWith('/rpc/control_listening')){const data=route.request().postDataJSON();if(data.p_action==='start'){starts++;session={message_id:data.p_message,playing:false,position:0,changed_at:new Date().toISOString()};}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)});}return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Listen together',exact:true}).click();await expect(page.getByRole('button',{name:'Send an audio file'})).toBeVisible();await page.getByLabel('Choose audio').selectOption(track.id);await page.getByRole('button',{name:'Start shared session'}).click();await expect(page.getByRole('button',{name:'Join listening'})).toBeVisible();expect(starts).toBe(1);
});
test("two listening panels exchange play and pause through shared state",async({browser})=>{
 const context=await browser.newContext();const a=await context.newPage(),b=await context.newPage();
 let session:{message_id:string;playing:boolean;position:number;changed_at:string}|null=null;
 const track={id:'88888888-8888-4888-8888-888888888888',media_url:other+'/'+cid+'/song.wav',content:'Our song',created_at:new Date().toISOString()};
 const length=8000*20,bytes=Buffer.alloc(44+length*2);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(length*2,40);
 for(const page of [a,b]){await signedIn(page);await page.route('**/rest/v1/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;if(path.endsWith('/messages')&&url.searchParams.get('media_kind')==='eq.audio')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([track])});if(path.endsWith('/shared_listening'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)});if(path.endsWith('/rpc/control_listening')){const data=route.request().postDataJSON();session={message_id:data.p_message,playing:data.p_action==='play',position:data.p_position??0,changed_at:new Date().toISOString()};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)});}return route.fallback();});await page.route('**/storage/v1/object/sign/chat-media/**',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signedURL:'/object/sign/chat-media/song.wav?token=test'})}));await page.route('**/storage/v1/object/sign/chat-media/song.wav?*',async route=>route.fulfill({status:200,contentType:'audio/wav',body:bytes}));await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Listen together',exact:true}).click();}
 await a.getByLabel('Choose audio').selectOption(track.id);await a.getByRole('button',{name:'Start shared session'}).click();await a.getByRole('button',{name:'Join listening'}).click();await b.getByRole('button',{name:'Join listening'}).click({timeout:10000});await expect(a.getByRole('button',{name:'Play for both'})).toBeEnabled();await a.getByRole('button',{name:'Play for both'}).click();await expect(b.getByRole('button',{name:'Pause for both'})).toBeVisible({timeout:10000});await expect.poll(()=>b.locator('.listen-panel audio').evaluate((node:HTMLAudioElement)=>!node.paused),{timeout:10000}).toBe(true);await b.getByRole('button',{name:'Pause for both'}).click();await expect(a.getByRole('button',{name:'Play for both'})).toBeVisible({timeout:10000});await expect.poll(()=>a.locator('.listen-panel audio').evaluate((node:HTMLAudioElement)=>node.paused),{timeout:10000}).toBe(true);await context.close();
});

test("mobile login fields stay aligned and usable on compact screens",async({page})=>{
 for(const size of [{width:320,height:568},{width:375,height:812},{width:430,height:932},{width:568,height:320}]){
  await page.setViewportSize(size);await page.goto('/');
  const fields=page.locator('.auth-fields .input-icon');await expect(fields).toHaveCount(2);
  const a=await fields.nth(0).boundingBox(),b=await fields.nth(1).boundingBox(),submit=await page.getByRole('button',{name:'Log in',exact:true}).boundingBox();
  expect(a&&b&&submit).toBeTruthy();expect(Math.abs(a!.x-b!.x)).toBeLessThan(1);expect(Math.abs(a!.width-b!.width)).toBeLessThan(1);expect(Math.abs(a!.width-submit!.width)).toBeLessThan(1);expect(a!.x).toBeGreaterThanOrEqual(0);expect(a!.x+a!.width).toBeLessThanOrEqual(size.width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('tab',{name:'Create account'}).click();await expect(page.getByRole('button',{name:'Create account',exact:true})).toBeVisible();await page.getByRole('button',{name:'Show password'}).click();await expect(page.getByRole('textbox',{name:'Password'})).toHaveAttribute('type','text');
 }
});
test("mobile inbox controls align and remain actionable at narrow widths",async({page})=>{
 await signedIn(page);
 for(const size of [{width:320,height:568},{width:375,height:812},{width:430,height:932}]){
  await page.setViewportSize(size);await page.goto('/');await expect(page.getByRole('button',{name:/Alex.*Hello/})).toBeVisible();
  const buttons=page.locator('.inbox-group-actions button');const boxes=await Promise.all([0,1,2].map(i=>buttons.nth(i).boundingBox()));expect(boxes.every(Boolean)).toBe(true);expect(Math.abs(boxes[0]!.width-boxes[1]!.width)).toBeLessThan(1);expect(Math.abs(boxes[1]!.width-boxes[2]!.width)).toBeLessThan(1);expect(boxes[0]!.x).toBeGreaterThanOrEqual(0);expect(boxes[2]!.x+boxes[2]!.width).toBeLessThanOrEqual(size.width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Groups',exact:true}).click();await expect(page.getByRole('button',{name:'Groups',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'All',exact:true}).click();
  await page.getByRole('button',{name:'New group',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('button',{name:/Alex.*Hello/})).toBeVisible();
 }
});

test("call uses issued ICE credentials and stays open when navigating away",async({page},testInfo)=>{
 await signedIn(page); let issued=0, ended=0, relayDown=false;
 await page.addInitScript(()=>{
  const context=new AudioContext();const destination=context.createMediaStreamDestination();
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>destination.stream});
  class FakePeer {
   connectionState='new';iceConnectionState='new';signalingState='stable';localDescription:any=null;remoteDescription:any=null;currentLocalDescription:any=null;
   onconnectionstatechange:(()=>void)|null=null;onicecandidate:any=null;ontrack:any=null;
   constructor(public configuration:RTCConfiguration){(window as any).__callIce=configuration.iceServers;}
   getSenders(){return [];} addTrack(){} async createOffer(){return {type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n'};}
   async setLocalDescription(value:any){this.localDescription=value;this.currentLocalDescription=value;setTimeout(()=>{this.connectionState='connected';this.onconnectionstatechange?.();},40);}
   async getStats(){return new Map();} close(){this.connectionState='closed';} async addIceCandidate(){}
  }
  (window as any).RTCPeerConnection=FakePeer;
 });
 await page.route('**/api/turn-credentials/**',async route=>{issued++;await route.fulfill({status:relayDown?503:200,contentType:'application/json',body:JSON.stringify(relayDown?{error:'Relay unavailable'}:{iceServers:[{urls:['turn:relay.example:3478'],username:'temporary',credential:'temporary'}]})});});
 await page.route('**/rest/v1/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/rpc/start_call'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'99999999-9999-4999-8999-999999999999',conversation_id:cid,caller:uid,callee:other,kind:'audio',status:'ringing',started_at:new Date().toISOString()})});if(path.endsWith('/rpc/end_call')){ended++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});}if(path.endsWith('/rpc/call_signal'))return route.fulfill({status:200,contentType:'application/json',body:'true'});return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Call',exact:true}).click();await expect(page.getByRole('dialog',{name:'Call with Alex'})).toBeVisible();await expect(page.getByRole('button',{name:'Share music'})).toBeEnabled();expect(issued).toBe(1);await page.screenshot({path:testInfo.outputPath('call.png')});expect(await page.evaluate(()=>((window as any).__callIce as RTCIceServer[]).some(x=>String(x.urls).includes('turn:relay.example')))).toBe(true);
 await page.getByRole('button',{name:'Share music'}).click();await expect(page.getByLabel('Voice volume')).toBeVisible();await page.getByRole('button',{name:'Close music'}).click();await page.getByRole('button',{name:'Minimise call'}).click();await expect(page.getByRole('button',{name:'Return to call'})).toBeVisible();
 const back=page.getByRole('button',{name:'Back to messages'});if(await back.isVisible())await back.click();else await page.locator('.rail').getByRole('button',{name:'Messages'}).click();await expect(page.getByRole('button',{name:'Return to call'})).toBeVisible();expect(ended).toBe(0);await page.getByRole('button',{name:'Return to call'}).click();await page.getByRole('button',{name:'End call'}).click();await expect.poll(()=>ended).toBe(1);await expect(page.getByRole('dialog',{name:'Call with Alex'})).toHaveCount(0);
 relayDown=true;await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Call',exact:true}).click();await expect(page.getByText(/Call relay unavailable. Trying a direct connection/)).toBeVisible();expect(await page.evaluate(()=>((window as any).__callIce as RTCIceServer[]).every(x=>!String(x.urls).includes('turn:relay.example')))).toBe(true);await page.getByRole('button',{name:'End call'}).click();await expect.poll(()=>ended).toBe(2);
});

test("incoming calls ring from the inbox without opening the chat first",async({page})=>{
 await signedIn(page);let ringing=true,declined=0;
 const row={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',conversation_id:cid,caller:other,callee:uid,kind:'audio',status:'ringing',started_at:new Date().toISOString()};
 await page.route('**/rest/v1/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/calls'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ringing?[row]:[])});if(path.endsWith('/rpc/answer_call')){ringing=false;declined++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});}return route.fallback();});
 await page.goto('/');await expect(page.getByRole('dialog',{name:'Call with Alex'})).toBeVisible({timeout:12000});await page.getByRole('button',{name:'Decline call'}).click();await expect.poll(()=>declined).toBe(1);
});

test('cold call notification preserves the call link and requires a page gesture to answer',async({page})=>{
 await signedIn(page);let answered=0,mediaRequests=0;
 const callId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const row={id:callId,conversation_id:cid,caller:other,callee:uid,kind:'audio',status:'ringing',started_at:new Date().toISOString()};
 await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>{(window as any).__mediaRequests=((window as any).__mediaRequests||0)+1;return Promise.reject(new DOMException('blocked','NotAllowedError'));}});});
 await page.route('**/rest/v1/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);if(name==='calls')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([row])});if(name==='answer_call'){answered++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});}return route.fallback();});
 await page.goto('/?call='+callId+'&chat='+cid+'&account='+uid+'&accept=1');
 await expect(page.getByRole('dialog',{name:'Call with Alex'})).toBeVisible({timeout:12000});
 mediaRequests=await page.evaluate(()=>(window as any).__mediaRequests||0);expect(mediaRequests).toBe(0);expect(answered).toBe(0);
 await expect.poll(()=>page.evaluate(()=>location.search)).toBe('');
 await page.getByRole('button',{name:'Accept call'}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__mediaRequests||0)).toBe(1);
});

test('a stale call can be ended explicitly before retrying',async({page})=>{
 await signedIn(page);let ended=0;
 await page.addInitScript(()=>{const ctx=new AudioContext(),sink=ctx.createMediaStreamDestination();Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>sink.stream});});
 await page.route('**/rest/v1/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);if(name==='start_call')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'A call is already in progress here.'})});if(name==='end_open_call'){ended++;return route.fulfill({status:200,contentType:'application/json',body:'true'});}return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Call',exact:true}).click();
 await expect(page.getByText('A call is already in progress here.')).toBeVisible();await page.getByRole('button',{name:'End previous call'}).click();await expect.poll(()=>ended).toBe(1);await expect(page.getByRole('dialog',{name:'Call with Alex'})).toHaveCount(0);
});

test('chat sketch overlays the conversation and sends only transparent ink, with retry',async({page})=>{
 await signedIn(page); let uploads=0; let png:Buffer|undefined; let sent:any=null;
 await page.route('**/rest/v1/messages*',async route=>{if(route.request().method()==='POST')sent=route.request().postDataJSON();return route.fallback();});
 await page.route('**/storage/v1/object/chat-media/**',async route=>{
  uploads++; if(uploads===1)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Upload failed'})});
  png=route.request().postDataBuffer() ?? undefined;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({Key:new URL(route.request().url()).pathname})});
 });
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();
 await page.getByRole('button',{name:'Draw on chat'}).click();const dialog=page.getByRole('dialog',{name:'Draw on chat'});await expect(dialog).toBeVisible();
 await expect(page.locator('.message-text').filter({hasText:'Hello'})).toBeVisible();
 await expect(dialog.getByText('Only your drawing is sent, not the chat behind it.')).toBeVisible();
 const canvas=dialog.getByLabel('Draw over conversation');const rect=await canvas.boundingBox();if(!rect)throw new Error('Canvas has no bounds');
 const x=rect.x+rect.width*.45,y=rect.y+rect.height*.6;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+25,{steps:5});await page.mouse.up();
 await expect(dialog.getByRole('button',{name:'Undo drawing'})).toBeEnabled();await dialog.getByRole('button',{name:'Undo drawing'}).click();await expect(dialog.getByRole('button',{name:'Send drawing'})).toBeDisabled();
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+25,{steps:5});await page.mouse.up();
 await dialog.getByRole('button',{name:'Send drawing'}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Send drawing'}).click();await expect(dialog).toHaveCount(0);expect(uploads).toBe(2);expect(png).toBeTruthy();
 const start=png!.indexOf(Buffer.from([137,80,78,71,13,10,26,10]));const end=png!.indexOf(Buffer.from('IEND'),start);expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);const image=png!.subarray(start,end+8);
 const info=await page.evaluate(async data=>{const img=await createImageBitmap(await (await fetch('data:image/png;base64,'+data)).blob());const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])ink++;return {corner:pixels[3],ink,total:c.width*c.height};},image.toString('base64'));
 expect(info.corner).toBe(0);expect(info.ink).toBeGreaterThan(0);expect(info.ink).toBeLessThan(info.total/10);
 await expect.poll(()=>sent?.media_kind).toBe('image');expect(sent.content).toBe('Drawing');expect(sent.media_url).toMatch(new RegExp('^'+uid+'/'+cid+'/.*\\.png$'));
 await expect(page.getByRole('button',{name:'Draw together'})).toBeVisible();
});

test('chat sketch protects unsent ink on close',async({page})=>{
 await signedIn(page);await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();await page.getByRole('button',{name:'Draw on chat'}).click();const dialog=page.getByRole('dialog',{name:'Draw on chat'});const canvas=dialog.getByLabel('Draw over conversation');const rect=await canvas.boundingBox();if(!rect)throw new Error('Canvas has no bounds');await page.mouse.click(rect.x+rect.width*.5,rect.y+rect.height*.6);
 page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Close drawing'}).click();await expect(dialog).toBeVisible();
 page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Draw on chat'})).toBeFocused();
});

test('iOS text effects persist through the outbox and render on the bubble',async({page})=>{
 let sent:any=null;
 await signedIn(page);
 await page.route('**/rest/v1/messages*',async route=>{if(route.request().method()==='POST')sent=route.request().postDataJSON();return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();
 const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('This is big');
 await page.getByRole('button',{name:'Text effects',exact:true}).click();
 await page.getByRole('button',{name:'Big text effect',exact:true}).click();
 await expect(page.getByRole('button',{name:'Text effects',exact:true})).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.locator('.bubble.effect-big').filter({hasText:'This is big'})).toBeVisible();
 await expect.poll(()=>sent?.text_effect).toBe('big');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('affection tray is reachable from attachments and sends a quick affection',async({page})=>{
 let sent:any=null;
 await signedIn(page);
 await page.route('**/rest/v1/messages*',async route=>{if(route.request().method()==='POST')sent=route.request().postDataJSON();return route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/Alex.*Hello/}).click();
 await page.getByRole('button',{name:'Attachments',exact:true}).click();
 await page.getByRole('button',{name:'Quick affection',exact:true}).click();
 await expect(page.getByRole('group',{name:'Affection'})).toBeVisible();
 await page.getByRole('button',{name:'Send hug',exact:true}).click();
 await expect.poll(()=>sent?.content).toContain('A hug for you');
});
