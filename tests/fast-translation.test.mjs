import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSettings, publicSettings, readingEngine, translationReady, effectiveConfig, cacheKey, fingerprint } from '../extension/shared/core.mjs';
import { requestMachineTranslation } from '../extension/background/provider.mjs';
import { RequestGate } from '../extension/background/request-gate.mjs';
import { TranslationService } from '../extension/background/translation-service.mjs';

const fast = effectiveConfig(initialSettings());
const ai = effectiveConfig({ ...initialSettings(), readingEngine: 'ai', endpoint: 'https://example.com' });
const blocks = [{ id: 'a', text: 'Keep ⟦CLR0_0⟧this link⟦CLR0_1⟧.', sourceHash: 'a' }, { id: 'b', text: 'The number is 25.', sourceHash: 'b' }];

test('fresh fast mode needs no key while legacy settings keep their AI connection and cache identity', async () => {
  assert.equal(readingEngine(initialSettings()), 'bing'); assert.equal(translationReady(publicSettings(initialSettings())), true);
  const legacy = { ...initialSettings(), endpoint: 'https://example.com', apiKey: 'test-only' }; delete legacy.readingEngine;
  const before = structuredClone(legacy), safe = publicSettings(legacy);
  assert.equal(safe.readingEngine, 'ai'); assert.equal(safe.hasKey, true); assert.ok(!('apiKey' in safe)); assert.deepEqual(legacy, before);
  assert.equal(translationReady({ ...safe, hasKey: false }), false);
  const legacyConfig = effectiveConfig(legacy);
  assert.equal(fingerprint(legacyConfig), fingerprint({ ...legacyConfig, engine: undefined }));
  assert.notEqual(await cacheKey(fast, blocks[0], 'x.com'), await cacheKey(legacyConfig, blocks[0], 'x.com'));
  assert.equal(await cacheKey(fast, blocks[0], 'x.com'), await cacheKey(effectiveConfig({ ...initialSettings(), connectionRevision: 99 }), blocks[0], 'x.com'));
});

test('machine list requests omit credentials and preserve input identity and protected links', async () => {
  let request;
  const result = await requestMachineTranslation(fast, blocks, { fetcher: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify([{ translations: [{ text: '保留⟦CLR0_0⟧这个链接⟦CLR0_1⟧。' }] }, { translations: [{ text: '数字是25。' }] }]));
  } });
  assert.equal(new URL(request.url).searchParams.get('to'), 'zh-Hans');
  assert.deepEqual(JSON.parse(request.options.body), blocks.map(block => block.text));
  assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error');
  assert.ok(!('Authorization' in request.options.headers));
  assert.deepEqual(result.translations.map(value => [value.id, value.sourceHash]), [['a', 'a'], ['b', 'b']]);
  assert.equal(result.synthetic, false);
});

test('machine transport rejects incomplete, wrong-type and altered protected results', async () => {
  for (const payload of [{ error: 'bad' }, [], [{ translations: [{ text: 'missing markers' }] }, { translations: [{ text: 'ok' }] }], [{ translations: [{ text: '⟦CLR0_1⟧wrong⟦CLR0_0⟧' }] }, { translations: [{ text: 'ok' }] }]]) {
    await assert.rejects(requestMachineTranslation(fast, blocks, { fetcher: async () => new Response(JSON.stringify(payload)) }), /RESPONSE_INCOMPLETE/);
  }
});

test('machine errors retain status and bounded retry delay without reflected bodies', async () => {
  let cancelled = false;
  await assert.rejects(requestMachineTranslation(fast, blocks, { fetcher: async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '999' }), body: { cancel: async () => { cancelled = true; } }, json: () => { throw new Error('must not read a private error body'); } }) }), error => error.message === 'HTTP_429' && error.retryAfterMs === 120000);
  assert.equal(cancelled, true);
});

test('machine cancellation during body reading is safe and cannot deliver results', async () => {
  const controller = new AbortController();
  await assert.rejects(requestMachineTranslation(fast, blocks, { signal: controller.signal, fetcher: async () => ({ ok: true, json: async () => { controller.abort(); return []; } }) }), /CANCELLED/);
});

test('AI authentication pause does not disable the independent fast provider', async () => {
  const gate = new RequestGate({ intervalMs: 0 });
  await assert.rejects(gate.run(ai, async () => { throw new Error('HTTP_401'); }), /HTTP_401/);
  assert.equal(await gate.run(fast, async () => 'fast works'), 'fast works');
  await assert.rejects(gate.run(ai, async () => 'must stay paused'), /HTTP_401/);
});

test('fast provider cooldown does not defer an AI request', async () => {
  const gate = new RequestGate({ intervalMs: 0 });
  const error = new Error('HTTP_429'); error.retryAfterMs = 60000;
  await assert.rejects(gate.run(fast, async () => { throw error; }), /HTTP_429/);
  let timer;
  try {
    const result = await Promise.race([gate.run(ai, async () => 'AI works'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OTHER_PROVIDER_BLOCKED')), 500); })]);
    assert.equal(result, 'AI works');
  } finally { clearTimeout(timer); clearTimeout(gate.timer); }
});

test('short fast paragraphs form a single bounded list request', async () => {
  const service = new TranslationService({ get: async () => null, put: async () => {} });
  const calls = [], input = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, text: `Public paragraph ${i}.`, sourceHash: `${i}` }));
  const result = await service.translate(fast, input, { hostname: 'example.org', revision: 1, private: false, isCurrent: () => true,
    dispatch: async fresh => { calls.push(fresh); return { translations: fresh.map(block => ({ id: block.id, text: '公开示例译文。' })) }; } });
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 4); assert.deepEqual(result.map(value => value.id), input.map(value => value.id));
  assert.ok(calls[0].reduce((sum, block) => sum + block.text.length, 0) <= 1800);
});
