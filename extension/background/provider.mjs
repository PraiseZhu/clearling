import { parseTranslations, translationBody } from '../shared/core.mjs';

export async function requestTranslation(config, apiKey, blocks, { signal, fetcher = fetch, timeout = 20000 } = {}) {
  const started = performance.now();
  const deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let response;
  try {
    response = await fetcher(config.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(translationBody(config, blocks)), signal: combined, redirect: 'error', credentials: 'omit'
    });
  } catch {
    if (deadline.aborted) throw new Error('REQUEST_TIMEOUT');
    if (signal?.aborted) throw new Error('CANCELLED');
    throw new Error('REQUEST_FAILED');
  }
  if (!response.ok) {
    const error = new Error(`HTTP_${response.status}`);
    if (response.status === 429) {
      const value = response.headers?.get('retry-after');
      const seconds = value != null && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value || '') - Date.now();
      error.retryAfterMs = Number.isFinite(seconds) ? Math.max(1000, Math.min(120000, seconds)) : 2000;
    }
    await response.body?.cancel(); throw error;
  }
  let payload;
  try { payload = await response.json(); }
  catch {
    if (deadline.aborted) throw new Error('REQUEST_TIMEOUT');
    if (signal?.aborted) throw new Error('CANCELLED');
    throw new Error('RESPONSE_INVALID');
  }
  if (combined.aborted) throw new Error(deadline.aborted ? 'REQUEST_TIMEOUT' : 'CANCELLED');
  const content = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.filter(v => v.type === 'text').map(v => v.text).join('') : content;
  return { translations: parseTranslations(text, blocks), elapsedMs: Math.round(performance.now() - started),
    reportedModel: typeof payload.model === 'string' ? payload.model.slice(0, 180) : null, synthetic: payload.clearling_test_provider === true };
}

/** List transport for the fast reading engine. Credentials never enter this path. */
export async function requestMachineTranslation(config, blocks, { signal, fetcher = fetch, timeout = 10000 } = {}) {
  const started = performance.now(), deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const url = new URL(config.endpoint);
  url.searchParams.set('to', 'zh-Hans'); url.searchParams.set('isEnterpriseClient', 'false');
  let response, payload;
  const cancelled = () => deadline.aborted ? new Error('REQUEST_TIMEOUT') : signal?.aborted ? new Error('CANCELLED') : new Error('REQUEST_FAILED');
  try {
    response = await fetcher(url.href, { method: 'POST', headers: { accept: '*/*', 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks.map(block => block.text)), credentials: 'omit', redirect: 'error', signal: combined });
  } catch { throw cancelled(); }
  if (!response.ok) {
    const error = new Error(`HTTP_${response.status}`);
    if (response.status === 429) {
      const value = response.headers?.get('retry-after');
      const ms = value != null && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value || '') - Date.now();
      error.retryAfterMs = Number.isFinite(ms) ? Math.max(1000, Math.min(120000, ms)) : 2000;
    }
    await response.body?.cancel(); throw error;
  }
  try { payload = await response.json(); }
  catch { if (combined.aborted) throw cancelled(); throw new Error('RESPONSE_INVALID'); }
  if (combined.aborted) throw cancelled();
  if (!Array.isArray(payload) || payload.length !== blocks.length) throw new Error('RESPONSE_INCOMPLETE');
  const values = payload.map((value, index) => ({ id: blocks[index].id, text: value?.translations?.[0]?.text }));
  return { translations: parseTranslations(JSON.stringify({ translations: values }), blocks),
    elapsedMs: Math.round(performance.now() - started), reportedModel: 'microsoft-edge',
    synthetic: response.headers?.get('x-clearling-test-provider') === 'true' };
}
