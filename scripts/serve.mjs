import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname} from "node:path";
const root=resolve("out"),types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".webmanifest":"application/manifest+json",".txt":"text/plain"};
const relayHeaders={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS","X-Content-Type-Options":"nosniff"};
createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,"http://localhost");
  if (/^\/api\/turn-credentials\/?$/.test(url.pathname)) {
   if(req.method==="OPTIONS"){res.writeHead(204,relayHeaders);res.end();return;}
   if(req.method!=="GET"&&req.method!=="POST"){res.writeHead(405,relayHeaders);res.end(JSON.stringify({error:"Method not allowed"}));return;}
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>1024){res.writeHead(400,relayHeaders);res.end(JSON.stringify({error:"Invalid request"}));return;}chunks.push(chunk);}
   const base=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://llweydgvtpwgnslvgnqm.supabase.co";
   const upstream=await fetch(base+"/functions/v1/turn-credentials"+url.search,{method:req.method,headers:{...(req.headers.authorization?{authorization:req.headers.authorization}:{}),...(req.headers.apikey?{apikey:req.headers.apikey}:{}),"content-type":"application/json"},...(req.method==="POST"?{body:Buffer.concat(chunks)}:{}),signal:AbortSignal.timeout(15000)});
   res.writeHead(upstream.status,relayHeaders);res.end(await upstream.text());return;
  }
  let path=resolve(root,"."+decodeURIComponent(url.pathname));if(path!==root&&!path.startsWith(root+"/")){res.writeHead(403);res.end();return;}
  let info=await stat(path);if(info.isDirectory())path=resolve(path,"index.html");const data=await readFile(path);
  res.writeHead(200,{"Content-Type":types[extname(path)]||"application/octet-stream","Cache-Control":path.includes("_next/static")?"public,max-age=31536000,immutable":"no-cache","X-Content-Type-Options":"nosniff"});res.end(data);
 }catch{if(req.url?.startsWith("/api/turn-credentials")){res.writeHead(503,relayHeaders);res.end(JSON.stringify({error:"Call relay unavailable."}));}else{res.writeHead(404);res.end("Not found");}}
}).listen(Number(process.env.PORT||3000),"0.0.0.0");
