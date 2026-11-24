import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messageLinks} from '../lib/messageLinks';
test('message links preserve text, safely link public https, and retain punctuation',()=>{
 assert.deepEqual(messageLinks('Watch https://www.instagram.com/reel/abc_123/?igsh=x, then https://youtu.be/abcdefghijk!'),[
  {text:'Watch '},{text:'https://www.instagram.com/reel/abc_123/?igsh=x',url:'https://www.instagram.com/reel/abc_123/?igsh=x'},
  {text:', then '},{text:'https://youtu.be/abcdefghijk',url:'https://youtu.be/abcdefghijk'},{text:'!'}]);
});
test('unsafe or local URLs remain text',()=>{
 for(const value of ['javascript:alert(1)','http://example.com/','https://user:secret@example.com/', 'https://127.0.0.1/a'])assert.deepEqual(messageLinks(value),[{text:value}]);
});
