import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleText, splitSource, restoreProtected } from '../extension/content/planner.mjs';
import { parseTranslations, effectiveConfig, initialSettings } from '../extension/shared/core.mjs';
import { TranslationService } from '../extension/background/translation-service.mjs';
import { TranslationCache } from '../extension/background/cache.mjs';

test('explicit social body translates short replies but excludes Chinese and handles', () => {
  for (const text of ['Yes', 'No.', 'OK', 'AI is useful.', 'ありがとう']) assert.equal(eligibleText(text, { site: 'x' }), true, text);
  for (const text of ['这是中文回复', '@example', '12345', 'https://example.org']) assert.equal(eligibleText(text, { site: 'x' }), false, text);
  assert.equal(eligibleText('OK'), false);
});
test('long paragraphs retain every character and protected token across batches', () => {
  const text = ('A clear sentence with inline code ⟦CLR0_0⟧ and a link.\n').repeat(180);
  const chunks = splitSource(text);
  assert.ok(chunks.length > 2); assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length < 1900));
  assert.ok(chunks.every(chunk => (chunk.match(/⟦/g) || []).length === (chunk.match(/⟧/g) || []).length));
  assert.equal(restoreProtected('使用 ⟦CLR0_0⟧。', new Map([['⟦CLR0_0⟧', 'cacheKey']])), '使用 cacheKey。');
});
test('provider output must retain local protected placeholders', () => {
  const blocks = [{ id: 'b1', text: 'Use ⟦CLR0_0⟧.', sourceHash: 'hash' }];
  assert.throws(() => parseTranslations('{"translations":[{"id":"b1","text":"使用缓存键"}]}', blocks), /RESPONSE_INCOMPLETE/);
  assert.equal(parseTranslations('{"translations":[{"id":"b1","text":"使用⟦CLR0_0⟧"}]}', blocks)[0].text, '使用⟦CLR0_0⟧');
});
const config = effectiveConfig({ ...initialSettings(), endpoint: 'https://example.com' });
const block = { id: 'b1', text: 'A public sample.', sourceHash: 'one' };
test('disable during cache lookup prevents dispatch', async () => {
  let release, entered; const inCache = new Promise(r => { entered = r; }); let current = true, calls = 0;
  const service = new TranslationService({ get: () => { entered(); return new Promise(r => { release = r; }); }, put: async () => {} });
  const promise = service.translate(config, [block], { hostname: 'example.org', revision: 1, isCurrent: () => current, dispatch: async () => { calls++; return { translations: [] }; } });
  await inCache; current = false; release(null);
  await assert.rejects(promise, /CONFIG_CHANGED/); assert.equal(calls, 0);
});
test('different batches share the same paragraph and preserve each caller ID', async () => {
  let release, entered; const sent = new Promise(r => { entered = r; }); let calls = 0;
  const service = new TranslationService({ get: async () => null, put: async () => {} });
  const context = { hostname: 'example.org', revision: 1, isCurrent: () => true, dispatch: async blocks => { calls++; entered(); await new Promise(r => { release = r; }); return { translations: blocks.map(b => ({ id: b.id, text: '公共样本。' })) }; } };
  const a = service.translate(config, [block], context); await sent;
  const b = service.translate(config, [{ ...block, id: 'another-id' }], context);
  await new Promise(r => setTimeout(r, 15)); release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(calls, 1); assert.equal(first[0].id, 'b1'); assert.equal(second[0].id, 'another-id'); assert.equal(service.inflight.size, 0);
});
test('private cache does not populate the normal memory cache', async () => {
  const cache = new TranslationCache();
  await cache.put('public-hash', '私密窗口译文', true);
  assert.equal(await cache.get('public-hash', 30, true), '私密窗口译文');
  assert.equal(await cache.get('public-hash', 30, false), null);
});

test('cached paragraphs return while another result and cache persistence are blocked', async () => {
  let release, dispatchStarted;
  const dispatched = new Promise(r=>{dispatchStarted=r;});
  const received=[];
  let index=0;
  const service=new TranslationService({get:async()=>++index===1?'缓存译文':null,put:()=>new Promise(()=>{})});
  const response=service.translate(config,[block,{id:'b2',text:'An uncached public paragraph.'}],{
    hostname:'example.org',revision:1,isCurrent:()=>true,
    onTranslation:value=>received.push(value),
    dispatch:async blocks=>{dispatchStarted();await new Promise(r=>{release=r;});return {translations:blocks.map(b=>({id:b.id,text:'新的译文'}))};}
  });
  await dispatched;assert.deepEqual(received.map(v=>v.text),['缓存译文']);
  release();await response;assert.equal(received.length,2);
});
test('one cancelled subscriber leaves shared work running and all consumers settle', async()=>{
  let release, started;const entered=new Promise(r=>{started=r;});let calls=0,networkSignal;
  const service=new TranslationService({get:async()=>null,put:async()=>{}});
  const base={hostname:'example.org',revision:1,isCurrent:()=>true,dispatch:async(blocks,check,signal)=>{calls++;networkSignal=signal;started();await new Promise(r=>{release=r;});check();return {translations:blocks.map(b=>({id:b.id,text:'共享译文'}))};}};
  const a=new AbortController(),b=new AbortController();
  const first=service.translate(config,[block],{...base,signal:a.signal});const cancelled=assert.rejects(first,/CANCELLED/);await entered;
  const second=service.translate(config,[{...block,id:'second'}],{...base,signal:b.signal});
  while(![...service.inflight.values()][0]?.consumers.size || [...service.inflight.values()][0].consumers.size<2)await new Promise(r=>setImmediate(r));
  a.abort();await cancelled;assert.equal(networkSignal.aborted,false);release();
  assert.equal((await second)[0].id,'second');assert.equal(calls,1);assert.equal(service.inflight.size,0);
});
test('all cancelled consumers abort the network and a later request starts fresh',async()=>{
  let started;const entered=new Promise(r=>{started=r;});let signal;
  const service=new TranslationService({get:async()=>null,put:async()=>{}}),c=new AbortController();
  const ctx={hostname:'example.org',revision:1,isCurrent:()=>true};
  const pending=service.translate(config,[block],{...ctx,signal:c.signal,dispatch:async(b,check,s)=>{signal=s;started();await new Promise((_,reject)=>s.addEventListener('abort',()=>reject(new Error('CANCELLED')),{once:true}));}});
  const failed=assert.rejects(pending,/CANCELLED/);await entered;c.abort();await failed;assert.equal(signal.aborted,true);
  const next=await service.translate(config,[block],{...ctx,dispatch:async b=>({translations:b.map(x=>({id:x.id,text:'重新翻译'}))})});assert.equal(next[0].text,'重新翻译');
});

test('initiator cancellation during another slow cache lookup cannot orphan a peer',async()=>{
  const {cacheKey}=await import('../extension/shared/core.mjs');
  const slowBlock={id:'slow',text:'Slow cache lookup unrelated to shared work.'};
  const slowKey=await cacheKey(config,slowBlock,'example.org');let releaseCache,releaseNetwork,entered;
  const dispatched=new Promise(r=>{entered=r;});
  const service=new TranslationService({get:async key=>key===slowKey?new Promise(r=>{releaseCache=r;}):null,put:async()=>{}});
  const ctx={hostname:'example.org',revision:1,isCurrent:()=>true,dispatch:async blocks=>{entered();await new Promise(r=>{releaseNetwork=r;});return {translations:blocks.map(b=>({id:b.id,text:'共享成功'}))};}};
  const abort=new AbortController();const a=service.translate(config,[block,slowBlock],{...ctx,signal:abort.signal});const failed=assert.rejects(a,/CANCELLED/);
  while(!releaseCache || !service.inflight.size)await new Promise(r=>setImmediate(r));
  const b=service.translate(config,[{...block,id:'peer'}],ctx);
  while([...service.inflight.values()][0].consumers.size<2)await new Promise(r=>setImmediate(r));
  abort.abort();releaseCache(null);await failed;await dispatched;releaseNetwork();
  assert.equal((await b)[0].text,'共享成功');assert.equal(service.inflight.size,0);
});
test('different callers reusing a local ID receive distinct wire IDs in a shared batch',async()=>{
  const service=new TranslationService({get:async()=>null,put:async()=>{}});const ids=[];
  const ctx={hostname:'example.org',revision:1,isCurrent:()=>true,dispatch:async blocks=>{ids.push(...blocks.map(b=>b.id));return {translations:blocks.map(b=>({id:b.id,text:'安全译文'}))};}};
  const results=await Promise.all([service.translate(config,[block],ctx),service.translate(config,[{...block,text:'A different paragraph from another tab.'}],ctx)]);
  assert.equal(new Set(ids).size,2);assert.equal(results[0][0].id,'b1');assert.equal(results[1][0].id,'b1');
});
