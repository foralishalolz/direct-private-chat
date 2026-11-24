import {test} from "node:test";
import assert from "node:assert/strict";
import {countdownSeconds,playbackPosition} from "../lib/liveTiming";
test("shared listening advances only while playing",()=>{
 const t="2026-11-21T12:00:00Z",now=Date.parse(t)+2500;
 assert.equal(playbackPosition(8,true,t,now),10.5);
 assert.equal(playbackPosition(8,false,t,now),8);
 assert.equal(playbackPosition(8,true,t,now-4000),8);
 assert.equal(playbackPosition(-1,true,"bad",now),0);
});
test("race countdown never goes negative",()=>{
 const t="2026-11-21T12:00:00Z",at=Date.parse(t);
 assert.equal(countdownSeconds(t,at-2100),3);
 assert.equal(countdownSeconds(t,at+1),0);
 assert.equal(countdownSeconds(null,at),0);
 assert.equal(countdownSeconds("bad",at),0);
});
