import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleText } from '../extension/content/planner.mjs';

test('semantic headings and directory labels translate short foreign text', () => {
  for (const text of ['はじめに', '概要', '目次', 'Intro', 'FAQ']) {
    assert.equal(eligibleText(text, { lang: 'ja', short: true }), true, text);
  }
  assert.equal(eligibleText('はじめに', { lang: 'ja' }), false, 'ordinary short labels retain their existing threshold');
  assert.equal(eligibleText('OK'), false);
});

test('short heading context retains Chinese, identifier, URL and numeric exclusions', () => {
  for (const text of ['自动 Build 状态： JOB_PENDING', '这是中文标题', '@example', '12345', 'https://example.org', '']) {
    assert.equal(eligibleText(text, { short: true }), false, text);
  }
  assert.equal(eligibleText('中文 API', { short: true }), false);
});
