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
