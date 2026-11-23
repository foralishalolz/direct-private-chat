import {normalizeReelUrl} from "./reels";
export type MessagePart={text:string;url?:string};
/** Only linkify validated public HTTPS links; everything else remains plain text. */
export function messageLinks(text:string):MessagePart[]{
 const result:MessagePart[]=[];let last=0;
 const pattern=/https:\/\/[^\s<>"']+/gi;
 for(const match of text.matchAll(pattern)){
  const position=match.index;let candidate=match[0];
  while(/[.,!?;:)}\]]$/.test(candidate))candidate=candidate.slice(0,-1);
  try{const url=normalizeReelUrl(candidate);if(position>last)result.push({text:text.slice(last,position)});result.push({text:candidate,url});last=position+candidate.length;}catch{/* keep invalid input as text */}
 }
 if(last<text.length)result.push({text:text.slice(last)});
 return result;
}
