import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("two local WebRTC peers negotiate audio and restart ICE", async ({ page }) => {
  const bundle = await build({entryPoints:["lib/rtc.ts"],bundle:true,write:false,platform:"browser",format:"iife",globalName:"RtcHarness",define:{"process.env.NEXT_PUBLIC_SUPABASE_URL":"undefined","process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY":"undefined","process.env.NODE_ENV":"\"production\""}});
  await page.goto('/');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result = await page.evaluate(async () => {
    const {CallLink} = (window as any).RtcHarness;
    const states:Record<string,string> = {}, remote:Record<string,number> = {};
    let a:any, b:any; const wait = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
    const handlers = (name:string) => ({onSignal:(signal:any)=>{if(signal.type==='candidate')void (name==='a'?b:a)?.candidate(signal.candidate);},onState:(state:string)=>{states[name]=state;},onRemote:(stream:MediaStream)=>{remote[name]=stream.getAudioTracks().length;}});
    a=new CallLink(handlers('a'),'a',[]); b=new CallLink(handlers('b'),'b',[]);
    const context=new AudioContext(), source=context.createOscillator(), output=context.createMediaStreamDestination();source.connect(output);source.start();
    a.addLocal(output.stream);b.addLocal(output.stream);
    try {
      const offer=await a.offer(),answer=await b.answer(offer);await a.accept(answer);
      for(let i=0;i<100&&!(states.a==='connected'&&states.b==='connected');i++)await wait(100);
      const first={...states},trackCounts={...remote};
      const restart=await a.restartOffer();const nextAnswer=await b.answer(restart);await a.accept(nextAnswer);
      for(let i=0;i<100&&!(states.a==='connected'&&states.b==='connected');i++)await wait(100);
      return {first,after:{...states},trackCounts,changed:offer.sdp!==restart.sdp};
    } finally {a.close();b.close();source.stop();output.stream.getTracks().forEach(t=>t.stop());await context.close();}
  });
  expect(result.first).toEqual({a:'connected',b:'connected'});expect(result.after).toEqual({a:'connected',b:'connected'});expect(result.trackCounts).toEqual({a:1,b:1});expect(result.changed).toBe(true);
});
