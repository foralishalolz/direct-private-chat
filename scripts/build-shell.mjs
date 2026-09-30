
import {readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});const result=[];for(const e of entries){const p=join(dir,e.name);if(e.isDirectory())result.push(...await files(p));else result.push(p);}return result;}
const assets=(await files("out")).filter(x=>x.endsWith(".js")&&x.includes("_next/static")||x.endsWith(".css")||x==="out/index.html"||x==="out/login/index.html"||(x==="out/icon.svg"||x.endsWith(".png")&&x.startsWith("out/")&&!x.includes("_next"))||x==="out/manifest.webmanifest");
const hash=createHash("sha256");for(const path of assets)hash.update(await readFile(path));const version=hash.digest("hex").slice(0,14);
const urls=assets.map(p=>"/"+p.slice(4));
await writeFile("out/sw.js","const VERSION="+JSON.stringify("bitchat-shell-"+version)+";\nconst ASSETS="+JSON.stringify(urls)+";\n"+await readFile("public/sw-template.js","utf8"));
await writeFile("out/build-info.json",JSON.stringify({version,built:new Date().toISOString()}));

