/** Estimate the shared playback position from a server timestamp. Network delay
 * and device clock skew can still introduce drift; do not use for billing. */
export function playbackPosition(position:number,playing:boolean,changedAt:string,now=Date.now()):number {
 const start=Number.isFinite(position)?Math.max(0,position):0;
 const stamp=Date.parse(changedAt);
 return start+(playing&&Number.isFinite(stamp)?Math.max(0,(now-stamp)/1000):0);
}
export function countdownSeconds(readyAt:string|null,now=Date.now()):number {
 if(!readyAt)return 0;
 const stamp=Date.parse(readyAt);
 return Number.isFinite(stamp)?Math.max(0,Math.ceil((stamp-now)/1000)):0;
}
