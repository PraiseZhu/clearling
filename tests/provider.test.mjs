import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveConfig, initialSettings, safeError } from '../extension/shared/core.mjs';
import { requestTranslation } from '../extension/background/provider.mjs';

const config = effectiveConfig({ ...initialSettings(), endpoint: 'https://example.com' });
const blocks = [{ id: 'first', text: 'Existing settings remain active.', sourceHash: 'public-sample' }];

test('provider uses private header and validates JSON translation contract', async () => {
  let request;
  const result = await requestTranslation(config, 'unit-test-value', blocks, { fetcher: async (url, opts) => {
    request = { url, opts };
    return new Response(JSON.stringify({ model: config.selection.modelId, choices: [{ message: { content: '{"translations":[{"id":"first","text":"现有设置保持生效。"}]}' } }] }));
  } });
  assert.equal(request.opts.headers.Authorization, 'Bearer unit-test-value');
  assert.equal(request.opts.redirect, 'error');
  assert.equal(request.opts.credentials, 'omit');
  assert.equal(result.translations[0].text, '现有设置保持生效。');
  assert.equal(JSON.stringify(result).includes('unit-test-value'), false);
});

test('HTTP errors never retain reflected response bodies', async () => {
  let error;
  try { await requestTranslation(config, 'unit-test-value', blocks, { fetcher: async () => new Response('reflected private value', { status: 401 }) }); }
  catch (e) { error = e; }
  assert.equal(error.message, 'HTTP_401');
  assert.equal(JSON.stringify(safeError(error)).includes('private value'), false);
});

test('HTTP 200 error objects and malformed translations are not success', async () => {
  await assert.rejects(requestTranslation(config, 'test', blocks, { fetcher: async () => new Response('{"error":{"message":"unsupported"}}') }), /RESPONSE_INVALID/);
  await assert.rejects(requestTranslation(config, 'test', blocks, { fetcher: async () => new Response('{"choices":[{"message":{"content":"{\\"translations\\":[]}"}}]}') }), /RESPONSE_INCOMPLETE/);
});

test('aborted provider request produces a safe cancellation code', async () => {
  const controller = new AbortController();
  const promise = requestTranslation(config, 'test', blocks, { signal: controller.signal, fetcher: async (url, opts) => new Promise((resolve, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('private upstream error')), { once: true }); }) });
  controller.abort();
  await assert.rejects(promise, /CANCELLED/);
});

test('cancellation during response body reading stays cancellation', async () => {
  const c = new AbortController();
  await assert.rejects(requestTranslation(config, 'test', blocks, { signal: c.signal, fetcher: async () => ({ ok: true, json: async () => { c.abort(); throw new DOMException('aborted', 'AbortError'); } }) }), /CANCELLED/);
});
