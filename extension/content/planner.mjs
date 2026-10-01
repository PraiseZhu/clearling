import { X_CANDIDATES, xKind } from './adapters.mjs';
export const BODY_SELECTOR = X_CANDIDATES;
export const SEMANTIC_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,summary';
export const CANDIDATE_SELECTOR = `${SEMANTIC_SELECTOR},div`;
export const OWN = '[data-clearling]';
export const EXCLUDED = 'script,style,noscript,pre,textarea,input,select,button,svg,math,canvas,video,audio,iframe,nav,[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"],[role="button"],[role="tab"],[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[hidden],[data-testid="User-Name"],[data-testid="UserName"],time,[data-clearling],.immersive-translate-target-wrapper,.immersive-translate-target-inner';
const SOFT_SKIP = '[translate="no"],.notranslate';

export function composedClosest(element, selector) {
  for (let current = element; current;) {
    const found = current.closest?.(selector);
    if (found) return found;
    current = current.getRootNode?.().host ?? null;
  }
  return null;
}
export function siteFor(document) {
  return /(^|\.)(x\.com|twitter\.com)$/.test(document.location?.hostname || '')
    || document.querySelector('article[data-testid="tweet"] [data-testid="tweetText"]') ? 'x' : 'generic';
}
export function eligibleText(text, { site = 'generic', lang = '' } = {}) {
  const plain = text.replace(/⟦CLR\d+_\d+⟧/g, '').trim();
  if (!plain || /^(https?:\/\/|www\.)\S+$/i.test(plain) || /^[@#$][\w.]+$/.test(plain)) return false;
  const han = (plain.match(/[\u3400-\u9fff]/g) || []).length;
  const foreign = (plain.match(/[\p{L}]/gu) || []).length - han;
  const eastAsianForeign = /[\u3040-\u30ff\uac00-\ud7af]/.test(plain) || /^(ja|ko)(-|$)/i.test(lang);
  if (!eastAsianForeign && han && han / Math.max(1, han + foreign) > 0.3 && !/[a-zA-Z]{2,}(?:[ ,]+[a-zA-Z]{2,}){3,}/.test(plain)) return false;
  if (foreign < 2 && !eastAsianForeign) return false;
  return site === 'x' || plain.length >= 5;
}
export function safeFlow(element) {
  if (element.hasAttribute('data-cl-source') && element.nextElementSibling?.matches('[data-clearling="translation"]')) return true;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || ['fixed', 'absolute'].includes(style.position)) return false;
  if (style.display.includes('grid')) return false;
  if (style.display.includes('flex')) return style.flexDirection === 'column';
  return ['block', 'flow-root', 'list-item', 'table-cell', '-webkit-box'].includes(style.display);
}
function nestedBoundary(element) {
  return element.matches(`${SEMANTIC_SELECTOR},div,section,article,main,ul,ol,table,header,footer,aside`);
}

/** Inline protected values stay local. Original markup is never rewritten. */
export function readSource(element, site = 'generic') {
  const parts = [], protectedValues = new Map(), protectedNodes = new Map();
  let prefix = 0;
  while (element.textContent.includes(`⟦CLR${prefix}_`)) prefix++;
  const protect = (text, descriptor) => { const token = `⟦CLR${prefix}_${protectedValues.size}⟧`; protectedValues.set(token, text); if (descriptor) protectedNodes.set(token, descriptor); parts.push(token); return token; };
  const visit = node => {
    if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
    if (node.nodeType !== 1 || node.matches(EXCLUDED)) return;
    if (site !== 'x' && node.matches(SOFT_SKIP)) return;
    if (node.tagName === 'BR') { parts.push('\n'); return; }
    if (node.matches('code,kbd,samp')) { protect(node.textContent, { type: 'value', tag: node.localName, text: node.textContent }); return; }
    if (node.tagName === 'IMG') { if (node.getAttribute('alt')) protect(node.getAttribute('alt')); return; }
    if (site !== 'x' && nestedBoundary(node)) return;
    if (node.matches('a[href],strong,b,em,i')) {
      const attrs = {};
      if (node.matches('a')) {
        const href = new URL(node.getAttribute('href'), document.baseURI);
        if (!['http:', 'https:', 'mailto:'].includes(href.protocol)) { for (const child of node.childNodes) visit(child); return; }
        attrs.href = href.href;
        if (node.target === '_blank') { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
      }
      const open = protect('', { type: 'open', tag: node.localName, attrs });
      for (const child of node.childNodes) visit(child);
      protect('', { type: 'close', open }); return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const node of element.childNodes) visit(node);
  const text = parts.join('').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, protectedValues, protectedNodes, identity: JSON.stringify([text, [...protectedValues], [...protectedNodes]]) };
}
export function planElement(element, site = 'generic') {
  if (!(element instanceof Element) || composedClosest(element, EXCLUDED) || element.isContentEditable) return null;
  const special = site === 'x';
  const kind = special ? xKind(element) : 'generic';
  if (special && !kind) return null;
  if (!special && (composedClosest(element, SOFT_SKIP) || composedClosest(element, 'header,footer,aside'))) return null;
  if (!safeFlow(element)) return null;
  const source = readSource(element, site);
  const lang = element.lang || element.closest('[lang]')?.lang || '';
  if (!eligibleText(source.text, { site, lang })) return null;
  if (!special && !element.matches(SEMANTIC_SELECTOR)) {
    if (source.text.length < 30 || element.querySelector('input,textarea,[contenteditable="true"]')) return null;
    if (element.querySelectorAll('a').length > 2 && source.text.length < 100) return null;
  }
  if (!element.parentNode) return null;
  const hasNative = selector => [...element.querySelectorAll(selector)].some(node => !node.closest(OWN));
  const interactive = hasNative('button,input,select,textarea,video,audio,iframe,canvas,svg,math,[role="button"],[contenteditable]:not([contenteditable="false"])');
  const mixed = interactive || !special && hasNative(`${SEMANTIC_SELECTOR},div,ul,ol,table`);
  // A mixed container's descendants must keep their native layout and controls.
  return { ...source, placement: mixed || element.tagName === 'SUMMARY' ? 'inside' : 'after', replaceable: !mixed && element.tagName !== 'SUMMARY', kind, lang };
}
export function restoreProtected(text, protectedValues) {
  for (const [token, value] of protectedValues) {
    if (!text.includes(token)) throw new Error('PROTECTED_TEXT_MISSING');
    text = text.split(token).join(value);
  }
  return text;
}
export function sourceHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${value.length}-${(hash >>> 0).toString(16)}`;
}
export function splitSource(text, limit = 1800) {
  const output = []; let current = '';
  const add = part => { if (current && current.length + part.length > limit) { output.push(current); current = ''; } current += part; };
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)) {
    if (segment.length <= limit) { add(segment); continue; }
    for (const word of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(segment)) {
      for (let i = 0; i < word.segment.length; i += limit) add(word.segment.slice(i, i + limit));
    }
  }
  if (current) output.push(current);
  for (let i = 0; i < output.length - 1; i++) {
    const start = output[i].lastIndexOf('⟦');
    if (start > output[i].lastIndexOf('⟧')) { output[i + 1] = output[i].slice(start) + output[i + 1]; output[i] = output[i].slice(0, start); }
  }
  return output.filter(Boolean);
}
