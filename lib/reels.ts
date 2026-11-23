/** Normalize public HTTPS links only; never embed credentials or local networks. */
export function normalizeReelUrl(input:string):string {
 const raw=input.trim();
 if(raw.length>2048||/[\s<>]/.test(raw))throw new Error("Use a valid HTTPS link.");
 let url:URL;try{url=new URL(raw);}catch{throw new Error("Use a valid HTTPS link.");}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=="https:"||url.username||url.password||url.port||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(host)||/^[0-9.]+$/.test(host)||/(^|\.)(localhost|local|internal)$/.test(host))throw new Error("Use a public HTTPS website address.");
 return url.href;
}
/** Prefer documented provider embeds when the user supplies a share URL. */
export function reelEmbedUrl(input:string):string {
 const url=new URL(normalizeReelUrl(input)), host=url.hostname.toLowerCase();
 let id:string|null=null;
 if(host==="youtu.be")id=url.pathname.split("/")[1]??null;
 if(["youtube.com","www.youtube.com","m.youtube.com"].includes(host)){
  const parts=url.pathname.split("/");
  if(parts[1]==="shorts"||parts[1]==="embed"||parts[1]==="live")id=parts[2]??null;
  else if(url.pathname==="/watch")id=url.searchParams.get("v");
 }
 if(id&&/^[a-zA-Z0-9_-]{11}$/.test(id))return `https://www.youtube.com/embed/${id}?playsinline=1`;
 if(["instagram.com","www.instagram.com"].includes(host)){
  const match=url.pathname.match(/^\/(reel|p)\/([A-Za-z0-9_-]+)\/?/);
  if(match)return `https://www.instagram.com/${match[1]}/${match[2]}/embed/`;
 }
 if(["tiktok.com","www.tiktok.com","m.tiktok.com"].includes(host)){
  const match=url.pathname.match(/\/video\/(\d+)/);
  if(match)return `https://www.tiktok.com/embed/v2/${match[1]}`;
 }
 return url.href;
}
