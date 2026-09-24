import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInput, handleImmediatePush } from '../supabase/functions/_shared/push-immediate.ts';
const id='11111111-1111-4111-8111-111111111111';
const input={title:'Aznif',body:'Tonight at 9',audience:'all'};
const device={id,user_id:id,expo_push_token:'ExpoPushToken[x]'};
const request=value=>new Request('https://local.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(value)});
function setup(overrides={}) {
 const sent=[],removed=[];
 return {sent,removed,deps:{authorize:async()=>null,list:async()=>[device],deactivate:async d=>{removed.push(d);},fetch:async(url,options)=>{sent.push({url,...options});return Response.json({data:[{status:'ok',id:'ticket'}]});},...overrides}};
}
test('send requires explicit audience and rejects scheduling, invalid UUIDs and empty users',()=>{
 for(const bad of [{title:'x',body:'x'},{...input,scheduledAt:'tomorrow'},{...input,userIds:[]},{title:'x',body:'x',userIds:['bad']}]) assert.throws(()=>parseInput(bad));
 assert.deepEqual(parseInput({title:'x',body:'x',userId:id}).userIds,[id]);
});
test('unauthorized and ordinary users never query or send',async()=>{
 for(const code of [401,403]){const s=setup({authorize:async()=>code,list:async()=>{throw Error('must not query');}});const r=await handleImmediatePush(request(input),s.deps);assert.equal(r.status,code);assert.equal(s.sent.length,0);}
});
test('immediate visible push contains only title/body and OS presentation fields',async()=>{
 const s=setup();const r=await handleImmediatePush(request(input),s.deps);const b=await r.json();assert.equal(b.complete,true);assert.equal(b.results[0].status,'accepted');
 const m=JSON.parse(s.sent[0].body)[0];assert.equal(m.ttl,0);assert.equal(m.priority,'high');assert.equal(m.body,'Tonight at 9');assert.equal(m.data,undefined);assert.equal(m.channelId,'general');assert.equal(m.url,undefined);assert.equal(m.categoryId,undefined);
 assert.equal(s.sent.length,1);
});
test('DeviceNotRegistered disables exact device while provider errors are returned without retry',async()=>{
 const s=setup({fetch:async()=>Response.json({data:[{status:'error',details:{error:'DeviceNotRegistered'}}]})});const b=await (await handleImmediatePush(request(input),s.deps)).json();assert.equal(b.results[0].status,'error');assert.deepEqual(s.removed,[device]);
});
test('network failure has unknown outcome and no retry',async()=>{
 let calls=0;const s=setup({fetch:async()=>{calls++;throw Error('offline');}});const r=await handleImmediatePush(request(input),s.deps);assert.equal(r.status,502);assert.equal((await r.json()).results[0].status,'unknown');assert.equal(calls,1);
});
test('selected users and environment reach lookup; no devices is successful empty result',async()=>{
 const s=setup({list:async parsed=>{assert.deepEqual(parsed.userIds,[id]);assert.equal(parsed.environment,'development');return [];}});
 const b=await (await handleImmediatePush(request({title:'x',body:'x',userIds:[id],environment:'development'}),s.deps)).json();assert.equal(b.complete,true);assert.deepEqual(b.results,[]);assert.equal(s.sent.length,0);
});
test('broadcast batches at 100 and returns cursor after bounded synchronous work',async()=>{
 let n=0;const s=setup({list:async()=>Array.from({length:100},()=>({...device,id:'00000000-0000-4000-8000-'+String(++n).padStart(12,'0')})),fetch:async(_url,options)=>{const messages=JSON.parse(options.body);assert.equal(messages.length,100);return Response.json({data:messages.map(()=>({status:'ok',id:'ticket'}))});}});
 const b=await (await handleImmediatePush(request(input),s.deps)).json();assert.equal(b.complete,false);assert.equal(b.results.length,500);assert.equal(b.nextCursor,'00000000-0000-4000-8000-000000000500');
});
test('oversized UTF-8 payload rejected before sending',async()=>{
 const s=setup();
 const bad=await handleImmediatePush(request({...input,title:'🎲'.repeat(60),body:String.fromCharCode(1).repeat(1000)}),s.deps);assert.equal(bad.status,400);assert.equal(s.sent.length,0);
});


test('routing and complex-system fields are rejected',()=>{
 for(const key of ['target','data','url','category','preferences','scheduledAt','requestId']) assert.throws(()=>parseInput({...input,[key]:'unused'}),/Unsupported field/);
});
