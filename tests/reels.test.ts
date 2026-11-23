import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReelUrl,reelEmbedUrl} from '../lib/reels';
test('reel links accept only public HTTPS addresses without credentials or ports',()=>{
 assert.equal(normalizeReelUrl(' https://example.com '),'https://example.com/');
 for(const url of ['http://example.com/','https://127.0.0.1/','https://localhost/','https://x.local/','https://user:pass@example.com/','https://example.com:8080/','javascript:alert(1)','https://example.com/a b'])assert.throws(()=>normalizeReelUrl(url),url);
});
test('reel links convert known share URLs to embed endpoints',()=>{
 assert.equal(reelEmbedUrl('https://youtube.com/shorts/abcdefghijk'),'https://www.youtube.com/embed/abcdefghijk?playsinline=1');
 assert.equal(reelEmbedUrl('https://youtu.be/abcdefghijk?t=1'),'https://www.youtube.com/embed/abcdefghijk?playsinline=1');
 assert.equal(reelEmbedUrl('https://www.instagram.com/reel/Abc_123/'),'https://www.instagram.com/reel/Abc_123/embed/');
 assert.equal(reelEmbedUrl('https://www.tiktok.com/@person/video/12345'),'https://www.tiktok.com/embed/v2/12345');
 assert.equal(reelEmbedUrl('https://example.com/path'),'https://example.com/path');
});
