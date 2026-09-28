
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname} from "node:path";
const root=resolve("out"),types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".webmanifest":"application/manifest+json",".txt":"text/plain"};
createServer(async(req,res)=>{try{const url=new URL(req.url,"http://localhost");let path=resolve(root,"."+decodeURIComponent(url.pathname));if(path!==root&&!path.startsWith(root+"/")){res.writeHead(403);res.end();return;}let info=await stat(path);if(info.isDirectory())path=resolve(path,"index.html");const data=await readFile(path);res.writeHead(200,{"Content-Type":types[extname(path)]||"application/octet-stream","Cache-Control":path.includes("_next/static")?"public,max-age=31536000,immutable":"no-cache","X-Content-Type-Options":"nosniff"});res.end(data);}catch{res.writeHead(404);res.end("Not found");}}).listen(Number(process.env.PORT||3000),"0.0.0.0");

