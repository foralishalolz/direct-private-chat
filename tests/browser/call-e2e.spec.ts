import { test, expect, devices, type Page, type WebSocketRoute } from '@playwright/test';

test('two app users negotiate real WebRTC over subscribed signaling, reconnect and release media', async ({browser}, info) => {
  const aId='11111111-1111-4111-8111-111111111111', bId='22222222-2222-4222-8222-222222222222';
  const conversation='33333333-3333-4333-8333-333333333333', callId='99999999-9999-4999-8999-999999999999';
  const aProfile={id:aId,username:'sam',display_name:'Sam',avatar_url:null,mood:null,is_pro:false};
  const bProfile={id:bId,username:'alex',display_name:'Alex',avatar_url:null,mood:null,is_pro:false};
  let call:Record<string,any>|null=null, starts=0, earlyStart=false;
  const sockets:{ws:WebSocketRoute;topics:Set<string>}[]=[]; const signals:string[]=[];
  const options={baseURL:'http://127.0.0.1:3000', ...(info.project.name==='mobile'?devices['iPhone 13']: {})};
  const contextA=await browser.newContext(options), contextB=await browser.newContext(options);
  const a=await contextA.newPage(), b=await contextB.newPage();
  async function setup(page:Page,id:string) {
    const me=id===aId?aProfile:bProfile;
    await page.addInitScript(({id})=>{
      const token=btoa(JSON.stringify({alg:'HS256'}))+'.'+btoa(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'}))+'.test';
      localStorage.setItem('sb-llweydgvtpwgnslvgnqm-auth-token',JSON.stringify({access_token:token,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}}));
      const context=new AudioContext(), oscillator=context.createOscillator(), destination=context.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>destination.stream});
      (window as any).__testStream=destination.stream;
      (window as any).__restarts=0;const restart=RTCPeerConnection.prototype.restartIce;RTCPeerConnection.prototype.restartIce=function(){(window as any).__restarts++;return restart.call(this);};
    },{id});
    await page.route('**/api/turn-credentials/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({iceServers:[{urls:'turn:invalid.example:3478',username:'test',credential:'test'}]})}));
    await page.route('**/rest/v1/**',async route=>{
      const url=new URL(route.request().url()), name=url.pathname.split('/').at(-1), data=route.request().postDataJSON()??{};let result:unknown=[];
      if(name==='profiles')result=url.searchParams.get('id')?.startsWith('in.')?[aProfile,bProfile]:me;
      if(name==='inbox_page')result=[{id:conversation,kind:'direct',title:'',member_a:aId,member_b:bId,created_at:new Date().toISOString(),last_activity:new Date().toISOString(),couple_a:false,couple_b:false,members:[aProfile,bProfile],preview:'Hello',read_at:null}];
      if(name==='calls')result=call && call.callee===id && call.status==='ringing'?[call]:[];
      if(name==='my_privacy')result={revision:0,share_online:true,share_last_active:true,share_typing:true,share_receipts:true};
      if(name==='start_call'){starts++;if(!sockets.some(s=>s.topics.has('realtime:call:'+conversation)))earlyStart=true;call={id:callId,conversation_id:conversation,caller:aId,callee:bId,kind:'audio',status:'ringing',started_at:new Date().toISOString()};result=call;}
      if(name==='answer_call'&&call){call={...call,status:data.p_accept?'active':'declined'};result=call;}
      if(name==='end_call'&&call){call={...call,status:'ended'};result=call;for(const s of sockets)if(s.topics.has('realtime:call:'+conversation))s.ws.send(JSON.stringify([null,null,'realtime:call:'+conversation,'broadcast',{event:'call',type:'broadcast',payload:{call_id:callId,status:'ended',by:id}}]));}
      if(name==='call_signal'&&call){
        const frame={...data.p_payload,from:id,callId};signals.push(frame.type);
        for(const s of sockets)if(s.topics.has('realtime:call:'+conversation))s.ws.send(JSON.stringify([null,null,'realtime:call:'+conversation,'broadcast',{event:'signal',type:'broadcast',payload:frame}]));
        result=true;
      }
      if(name==='mark_read')result=null;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.routeWebSocket('wss://llweydgvtpwgnslvgnqm.supabase.co/**', ws=>{
      const peer={ws,topics:new Set<string>()};sockets.push(peer);
      ws.onMessage(raw=>{try{const msg=JSON.parse(String(raw));if(!Array.isArray(msg))return;const [joinRef,ref,topic,event]=msg;
        if(event==='phx_join'){
          const delay=topic==='realtime:call:'+conversation&&id===aId?1200:0;
          setTimeout(()=>{peer.topics.add(topic);ws.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));},delay);
        }else if(event==='phx_leave'){peer.topics.delete(topic);ws.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));}
        else if(event==='heartbeat')ws.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));
      }catch{}});
    });
  }
  try {
    await setup(a,aId);await setup(b,bId);
    await a.goto('/');await a.getByRole('button',{name:/Alex.*Hello/}).click();await a.getByRole('button',{name:'Call',exact:true}).click();
    await expect.poll(()=>starts,{timeout:10000}).toBe(1);expect(earlyStart).toBe(false);
    await b.goto('/');await expect(b.getByRole('dialog',{name:'Call with Sam'})).toBeVisible({timeout:15000});
    await b.getByRole('button',{name:'Accept call'}).click();
    await expect(a.locator('.call-signal')).toContainText('Connected',{timeout:25000});
    await expect(b.locator('.call-signal')).toContainText('Connected',{timeout:25000});
    await expect.poll(()=>a.locator('main>audio').evaluate((el:HTMLAudioElement)=>!!(el.srcObject as MediaStream)?.getAudioTracks().length)).toBe(true);
    await expect.poll(()=>b.locator('main>audio').evaluate((el:HTMLAudioElement)=>!!(el.srcObject as MediaStream)?.getAudioTracks().length)).toBe(true);
    expect(signals).toContain('offer');expect(signals).toContain('answer');expect(signals).toContain('candidate');
    // A delayed ready from before connection must not reopen negotiation.
    const establishedOffers=signals.filter(type=>type==='offer').length;
    for(const socket of sockets)if(socket.topics.has('realtime:call:'+conversation))socket.ws.send(JSON.stringify([null,null,'realtime:call:'+conversation,'broadcast',{event:'signal',type:'broadcast',payload:{type:'ready',from:bId,callId}}]));
    await a.waitForTimeout(1000);expect(signals.filter(type=>type==='offer').length).toBe(establishedOffers);
    const before=signals.filter(type=>type==='offer').length, restartBefore=await a.evaluate(()=>(window as any).__restarts);
    await expect.poll(()=>a.evaluate(()=>{window.dispatchEvent(new Event('online'));return (window as any).__restarts;}),{timeout:15000,intervals:[500,1000]}).toBeGreaterThan(restartBefore);
    await expect.poll(()=>signals.filter(type=>type==='offer').length,{timeout:10000}).toBeGreaterThan(before);
    await a.getByRole('button',{name:'End call'}).click();
    await expect.poll(()=>a.evaluate(()=>(window as any).__testStream.getTracks()[0].readyState)).toBe('ended');
    await expect.poll(()=>b.evaluate(()=>(window as any).__testStream.getTracks()[0].readyState)).toBe('ended');
  } finally {await contextA.close();await contextB.close();}
});
