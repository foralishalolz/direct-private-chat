
import {test} from "node:test";
import assert from "node:assert/strict";
import {imageDimensions} from "../lib/imageDimensions";
import {imageFile} from "../lib/media";
const jpeg=(w:number,h:number)=>new Uint8Array([255,216,255,192,0,17,8,h>>8,h&255,w>>8,w&255,3,1,17,0,2,17,1,3,17,1]);
test("reads JPEG dimensions without allocating a bitmap",()=>assert.deepEqual(imageDimensions(jpeg(1600,1200)),{width:1600,height:1200}));
test("rejects a large JPEG before decoding on mobile",async()=>{await assert.rejects(imageFile(new Blob([jpeg(12000,12000)],{type:"image/jpeg"})),/too large/);});
test("rejects truncated and unsupported image headers",()=>{for(const data of [new Uint8Array(),jpeg(500,500).slice(0,9),new Uint8Array([71,73,70])])assert.throws(()=>imageDimensions(data),/could not be read/);});
test("reads lossless WebP dimensions",()=>{const b=new Uint8Array(30);b.set(new TextEncoder().encode("RIFF"),0);b.set(new TextEncoder().encode("WEBPVP8L"),8);b[20]=47;b[21]=255;b[22]=64;b[23]=127;assert.deepEqual(imageDimensions(b),{width:256,height:510});});
test("rejects oversized extended WebP before decoding",async()=>{const b=new Uint8Array(30);b.set(new TextEncoder().encode("RIFF"),0);b.set(new TextEncoder().encode("WEBPVP8X"),8);b.set([255,255,1,255,255,1],24);await assert.rejects(imageFile(new Blob([b],{type:"image/webp"})),/too large/);});
