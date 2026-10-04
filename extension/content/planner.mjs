import { X_CANDIDATES, xKind } from './adapters.mjs';
import { sourceText,isGeneratedText } from './source-text.mjs';
export const BODY_SELECTOR = X_CANDIDATES;
export const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
export const SEMANTIC_SELECTOR = `p,${HEADING_SELECTOR},li,blockquote,figcaption,td,th,dt,dd,summary`;
export const CANDIDATE_SELECTOR = `${SEMANTIC_SELECTOR},a[href*="#"],div`;
export const OWN = '[data-clearling]';
export const EXCLUDED = 'script,style,noscript,pre,textarea,input,select,button,svg,math,canvas,video,audio,iframe,[role="menu"],[role="menubar"],[role="toolbar"],[role="button"],[role="tab"],[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[hidden],[data-testid="User-Name"],[data-testid="UserName"],time,[data-clearling],.immersive-translate-target-wrapper,.immersive-translate-target-inner';
const NAVIGATION = 'nav,[role="navigation"]';
const TOC_SCOPE = `${NAVIGATION},aside,[role="doc-toc"],#toc,.toc,#table-of-contents,.table-of-contents,[data-testid="toc"]`;
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
export function articleTocLink(element) {
  if (!element.matches('a[href*="#"]') || !composedClosest(element, TOC_SCOPE)) return false;
  try {
    const document = element.ownerDocument, url = new URL(element.getAttribute('href'), document.baseURI);
    const current = new URL(document.location.href);
    if (!url.hash || url.origin !== current.origin || url.pathname !== current.pathname || url.search !== current.search) return false;
    const fragment = url.hash.slice(1);
    // Some publishers store the percent-encoded fragment itself as the ID.
    const target = document.getElementById(decodeURIComponent(fragment)) || document.getElementById(fragment);
    const heading = target?.closest(HEADING_SELECTOR);
    return Boolean(heading && !composedClosest(heading, `${EXCLUDED},${SOFT_SKIP},${NAVIGATION},aside,footer`));
  } catch { return false; }
}
export function articleTocLabel(element) {
  if (!element?.matches(`${HEADING_SELECTOR},div`) || !composedClosest(element, TOC_SCOPE)) return false;
  const list = element.nextElementSibling;
  if (!list) return false;
  const links = list.matches('a[href*="#"]') ? [list] : [...list.querySelectorAll('a[href*="#"]')];
  return links.some(articleTocLink);
}
export function eligibleText(text, { site = 'generic', lang = '', short = false } = {}) {
  const plain = text.replace(/⟦CLR\d+_\d+⟧/g, '').trim();
  if (!plain || /^(https?:\/\/|www\.)\S+$/i.test(plain) || /^[@#$][\w.]+$/.test(plain)) return false;
  const han = (plain.match(/[\u3400-\u9fff]/g) || []).length;
  const foreign = (plain.match(/[\p{L}]/gu) || []).length - han;
  const eastAsianForeign = /[\u3040-\u30ff\uac00-\ud7af]/.test(plain) || /^(ja|ko)(-|$)/i.test(lang);
  // Chinese prose with API names or status identifiers is already readable.
  // Require an actual foreign phrase before translating mixed Chinese text.
  const prose = plain.replace(/\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b|\b[A-Z]{2,}\b/g, '');
  if (!eastAsianForeign && han && !/[a-zA-Z]{2,}(?:[ ,]+[a-zA-Z]{2,}){3,}/.test(prose)) return false;
  if (foreign < 2 && !eastAsianForeign) return false;
  return site === 'x' || short || plain.length >= 5;
}
export function safeFlow(element, { inline = false } = {}) {
  const hiddenByUs = element.hasAttribute('data-cl-source');
  if (hiddenByUs) element.removeAttribute('data-cl-source');
  // Read values before restoring the attribute: computed styles are live.
  const computed = getComputedStyle(element);
  const style = { display: computed.display, visibility: computed.visibility, position: computed.position, flexDirection: computed.flexDirection };
  if (hiddenByUs) element.setAttribute('data-cl-source', '');
  if (style.display === 'none' || style.visibility === 'hidden' || ['fixed', 'absolute'].includes(style.position)) return false;
  if (inline && ['inline','inline-block','inline-flex','flex','inline-grid','grid'].includes(style.display)) return true;
  if (style.display.includes('grid')) return false;
  if (style.display.includes('flex')) return style.flexDirection === 'column';
  return ['block', 'flow-root', 'list-item', 'table-cell', '-webkit-box'].includes(style.display);
}
function nestedBoundary(element) {
  return element.matches(`${SEMANTIC_SELECTOR},div,section,article,main,ul,ol,table,header,footer,aside`);
}

/** Tokens preserve inline boundaries; native text slots never own host controls. */
export function readSource(element, site = 'generic', { native = site !== 'x', inlineBlocks = false } = {}) {
  const parts = [], protectedValues = new Map(), protectedNodes = new Map();
  const textSlots = [[]];
  let prefix = 0;
  while (element.textContent.includes(`⟦CLR${prefix}_`)) prefix++;
  const protect = (text, descriptor, splitSlot = true) => { const token = `⟦CLR${prefix}_${protectedValues.size}⟧`; protectedValues.set(token, text); if (descriptor) protectedNodes.set(token, descriptor); parts.push(token); if (splitSlot) textSlots.push([]); return token; };
  const visit = node => {
    if (node.nodeType === 3) {
      if(native&&isGeneratedText(node))return;
      let text = native ? sourceText(node) : node.nodeValue;
      if (native && ['normal','nowrap'].includes(getComputedStyle(node.parentElement || element).whiteSpace)) text = text.replace(/\s+/g, ' ');
      if (native) for (const part of text.split(/(\r\n|\r|\n)/g)) {
        if (/^[\r\n]+$/.test(part)) protect(part, { type: 'text-value' }, false); else parts.push(part);
      } else parts.push(text);
      textSlots.at(-1).push(node); return;
    }
    if (node.nodeType !== 1 || node.matches(OWN)) return;
    const style = native ? getComputedStyle(node) : null;
    if (node.matches(EXCLUDED) || node.matches(NAVIGATION) || native && (node.matches(SOFT_SKIP) || nestedBoundary(node) && !(inlineBlocks && node.tagName === 'DIV') || articleTocLink(node) || node.matches('img,picture,relative-time,time-ago,[datetime]') || style.display==='none' || style.visibility==='hidden' || style.opacity==='0')) {
      if (native && textSlots.some(slot => slot.some(text => sourceText(text).trim()))) protect('', { type: 'opaque' });
      return;
    }
    if (node.tagName === 'BR') { if (native) protect('\n', { type: 'break' }); else parts.push('\n'); return; }
    if (node.matches('code,kbd,samp')) { protect(node.textContent, { type: 'value', tag: node.localName, text: node.textContent, ...(native ? { element: node } : {}) }); return; }
    if (node.tagName === 'IMG') { if (node.getAttribute('alt')) protect(node.getAttribute('alt')); return; }
    if (node.matches(native ? `a[href],span,strong,b,em,i,u,s,small,sup,sub,mark,cite,q,abbr,bdi,bdo${inlineBlocks ? ',div' : ''}` : 'a[href],strong,b,em,i')) {
      const attrs = {};
      if (node.matches('a')) {
        const href = new URL(node.getAttribute('href'), document.baseURI);
        if (!['http:', 'https:', 'mailto:'].includes(href.protocol)) { for (const child of node.childNodes) visit(child); return; }
        attrs.href = href.href;
        if (node.target === '_blank') { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
      }
      const open = protect('', { type: 'open', tag: node.localName, attrs, ...(native ? { element: node } : {}) });
      for (const child of node.childNodes) visit(child);
      protect('', { type: 'close', open }); return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const node of element.childNodes) visit(node);
  if (native) {
    // A control following all prose does not split two text slots. Keeping its
    // boundary would needlessly invalidate cached text when controls appear.
    while (protectedNodes.size && [...protectedNodes.values()].at(-1)?.type === 'opaque' && !textSlots.at(-1).some(node => sourceText(node).trim())) {
      const token=[...protectedNodes.keys()].at(-1);
      protectedNodes.delete(token);protectedValues.delete(token);
      parts[parts.lastIndexOf(token)]='';
      const tail=textSlots.pop();textSlots.at(-1).push(...tail);
    }
  }
  const joined = parts.join('');
  const text = native ? joined.trim() : joined.replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const descriptors = [...protectedNodes].map(([token, { element: _element, ...descriptor }]) => [token, descriptor]);
  const sourceValues = textSlots.map(slot => slot.map(node => native ? sourceText(node) : node.nodeValue));
  return { text, protectedValues, protectedNodes, textSlots, sourceValues, rawIdentity: JSON.stringify(sourceValues), identity: JSON.stringify([text, [...protectedValues], descriptors]) };
}
export function planElement(element, site = 'generic') {
  if (!(element instanceof Element) || composedClosest(element, EXCLUDED) || element.isContentEditable) return null;
  const special = site === 'x';
  const kind = special ? xKind(element) : 'generic';
  if (special && !kind) return null;
  if (special && composedClosest(element, NAVIGATION)) return null;
  const heading = element.matches(HEADING_SELECTOR), tocLabel = !special && articleTocLabel(element);
  const toc = !special && (tocLabel || articleTocLink(element));
  const title = special && ['article-title','article-card'].includes(kind);
  const native = !special || title;
  if (!special && (composedClosest(element, SOFT_SKIP) || composedClosest(element, 'footer')
    || composedClosest(element, `${NAVIGATION},aside`) && !toc || composedClosest(element, 'header') && !heading && !toc
    || element.matches('a') && !toc || !heading && composedClosest(element.parentElement, HEADING_SELECTOR))) return null;
  if (!safeFlow(element, { inline: heading || toc || title })) return null;
  const hasNative = selector => [...element.querySelectorAll(selector)].some(node => !node.closest(OWN));
  // A layout/metadata container is not a paragraph. Its actual leaf paragraphs
  // are independently scanned, without inserting output into headers or rows.
  if (!special && !heading && !tocLabel && element.tagName === 'DIV' && hasNative(`${SEMANTIC_SELECTOR},div,section,article,ul,ol,table,button,input,select,textarea,img,svg,time,relative-time,time-ago,[datetime],[role="button"]`)) return null;
  const source = readSource(element, site, { native, inlineBlocks: heading || title || tocLabel });
  const lang = element.lang || element.closest('[lang]')?.lang || '';
  if (!eligibleText(source.text, { site, lang, short: heading || toc })) return null;
  if (!special && !toc && !element.matches(SEMANTIC_SELECTOR)) {
    if (source.text.length < 30 || element.querySelector('input,textarea,[contenteditable="true"]')) return null;
    if ([...element.querySelectorAll('a')].filter(node => !node.closest(OWN)).length > 2 && source.text.length < 100) return null;
  }
  if (!element.parentNode) return null;
  const interactive = hasNative('button,input,select,textarea,img,picture,video,audio,iframe,canvas,svg,math,[translate="no"],.notranslate,[role="button"],[contenteditable]:not([contenteditable="false"])');
  const style = getComputedStyle(element);
  const parent = element.parentElement || element.getRootNode().host;
  const parentStyle = parent ? getComputedStyle(parent) : null;
  if (native) return { ...source, placement: 'inside', replaceable: false, sourceElement: null, native: true, kind, lang };
  // A projection cannot inherit the source's grid placement, flex sizing, box
  // decoration or generated content. Keep those host-owned boxes in place.
  const layoutBox = element.matches('td,th') || parentStyle?.display.includes('grid')
    || parentStyle?.display.includes('flex') && (parentStyle.flexDirection !== 'column' || style.flexGrow !== '0' || style.flexShrink !== '1' || style.flexBasis !== 'auto' || style.order !== '0' || style.alignSelf !== 'auto')
    || ['paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].some(key => parseFloat(style[key]) > 0)
    || !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor)
    || style.backgroundImage !== 'none'
    || ['::before','::after'].some(pseudo => !['none','normal','""'].includes(getComputedStyle(element,pseudo).content));
  // Appending to clipped layout boxes could hide the translation or its native
  // controls. Leave these candidates to the website's own expansion controls.
  const mixed = interactive || layoutBox || !special && hasNative(`${SEMANTIC_SELECTOR},div,ul,ol,table`);
  if ((mixed || element.tagName === 'SUMMARY') && [style.overflowX, style.overflowY].some(value => ['hidden','clip','scroll','auto'].includes(value))) return null;
  // Draft.js owns the list shell and its generated counter. Replace only its
  // sole text block, retaining the native LI for numbering and indentation.
  const children = [...element.children].filter(node => !node.matches(OWN));
  const sourceElement = kind === 'article-paragraph' && element.tagName === 'LI' && !interactive
    && children.length === 1 && children[0].matches('div.public-DraftStyleDefault-block')
    && ![...element.childNodes].some(node => node.nodeType === 3 && node.nodeValue.trim())
    && readSource(children[0], site).identity === source.identity ? children[0] : null;
  // A mixed container's descendants must keep their native layout and controls.
  return { ...source, placement: sourceElement || mixed || element.tagName === 'SUMMARY' ? 'inside' : 'after', replaceable: !sourceElement && !mixed && element.tagName !== 'SUMMARY', sourceElement, kind, lang };
}
export function sameTranslation(source, translated, protectedValues) {
  const normalized = value => restoreProtected(value, protectedValues).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized(source) === normalized(translated);
}

// Dense markup is retried as readable text slots if a machine response loses
// protected markers. Native markup and private/code values remain local.
export function nativeFragmentPlan(item) {
  const boundaries=[],parts=[''];
  for(const part of item.text.split(/(⟦CLR\d+_\d+⟧)/g)){
    if(item.protectedNodes.has(part)){boundaries.push(part);parts.push('');}
    else parts[parts.length-1]+=part;
  }
  if(!boundaries.length)return null;
  const chunks=[],slots=parts.map(original=>{
    if(!eligibleText(original,{site:'x',lang:item.lang})&&!/^[aAiI]$/.test(original.trim()))return{original,indexes:[]};
    const pieces=splitSource(original),indexes=pieces.map(piece=>{chunks.push(piece);return chunks.length-1;});
    return{original,pieces,indexes};
  });
  return chunks.length?{chunks,slots,boundaries}:null;
}

export function joinNativeFragments(plan,results){
  return plan.slots.map((slot,i)=>{
    const text=slot.indexes.length?(slot.original.match(/^\s*/)?.[0]||'')+joinTranslations(slot.pieces,slot.indexes.map(index=>results[index]))+(slot.original.match(/\s*$/)?.[0]||''):slot.original;
    return text+(plan.boundaries[i]||'');
  }).join('');
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

/** Provider JSON trims chunks; preserve paragraph separators locally. */
export function joinTranslations(chunks, translations) {
  return translations.map((text, index) => {
    if (!index) return text.trim();
    const boundary = (chunks[index - 1].match(/\s+$/)?.[0] || '') + (chunks[index].match(/^\s+/)?.[0] || '');
    const breaks = boundary.match(/\n/g)?.length || 0;
    return (breaks ? '\n'.repeat(breaks) : '') + text.trim();
  }).join('');
}
