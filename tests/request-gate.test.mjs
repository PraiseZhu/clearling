import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestGate } from '../extension/background/request-gate.mjs';
import { requestTranslation } from '../extension/background/provider.mjs';
import { effectiveConfig, initialSettings } from '../extension/shared/core.mjs';

const config = effectiveConfig({ ...initialSettings(), readingEngine: 'ai', endpoint: 'https://example.com' });
test('401 pauses future dispatch until explicit connection test', async () => {
  const gate = new RequestGate({ intervalMs: 0 }); let calls = 0;
  const fail = async () => { calls++; throw new Error('HTTP_401'); };
  await assert.rejects(gate.run(config, fail), /HTTP_401/);
  await assert.rejects(gate.run(config, fail), /HTTP_401/);
  assert.equal(calls, 1);
  gate.resume(config);
  assert.equal(await gate.run(config, async () => 'resumed'), 'resumed');
});

test('429 cooldown prevents subsequent API dispatch', async () => {
  const gate = new RequestGate({ intervalMs: 0 });
  const error = new Error('HTTP_429'); error.retryAfterMs = 80;
  await assert.rejects(gate.run(config, async () => { throw error; }), /HTTP_429/);
  const started = Date.now();
  await gate.run(config, async () => 'ok');
  assert.ok(Date.now() - started >= 70);
});

test('provider preserves bounded Retry-After and no response body', async () => {
  let error;
  try { await requestTranslation(config, 'test', [{ id: 'sample', text: 'Public fixture.' }], { fetcher: async () => new Response('private reflected body', { status: 429, headers: { 'Retry-After': '10' } }) }); }
  catch (e) { error = e; }
  assert.equal(error.message, 'HTTP_429'); assert.equal(error.retryAfterMs, 10000);
  assert.equal(JSON.stringify(error).includes('private'), false);
});

test('dispatches remain spaced after a shared cooldown', async () => {
  const gate = new RequestGate({ intervalMs: 25 });
  const error = new Error('HTTP_429'); error.retryAfterMs = 80;
  await assert.rejects(gate.run(config, async () => { throw error; }), /HTTP_429/);
  const starts = [];
  await Promise.all(Array.from({ length: 3 }, () => gate.run(config, async () => { starts.push(Date.now()); })));
  assert.ok(starts[1] - starts[0] >= 20); assert.ok(starts[2] - starts[1] >= 20);
});

test('prefetch leaves a slot and visible work overtakes queued prefetch',async()=>{
  const gate=new RequestGate({limit:2,intervalMs:0});
  const config={connectionId:'priority',connectionRevision:1,selection:{modelId:'test'}};
  const started=[];let release;
  const first=gate.run(config,()=>{started.push('first');return new Promise(r=>{release=r;});},undefined,()=>10000);
  await new Promise(r=>setImmediate(r));
  const second=gate.run(config,async()=>{started.push('second');},undefined,()=>12000);
  await gate.run(config,async()=>{started.push('visible');},undefined,()=>0);
  assert.deepEqual(started,['first','visible']);release();await Promise.all([first,second]);assert.deepEqual(started,['first','visible','second']);
});
