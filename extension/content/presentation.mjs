const OUTPUT = '[data-clearling="translation"]';

export function anchor(item) { return item.element.hasAttribute('data-cl-source') && item.translation?.isConnected ? item.translation : item.element; }
export function ownsView(item) { return item.translation?.isConnected && (item.translation.dataset.inside === 'true' || item.placement === 'inside' ? item.translation.parentNode === item.element : item.translation.previousElementSibling === item.element && item.translation.parentNode === item.element.parentNode); }
export function restoreSource(item) { item.element.removeAttribute('data-cl-source'); }
export function disposeView(item) { restoreSource(item); item.translation?.remove(); item.translation = null; }
export function isInteracting(item) {
  if (item.element.contains(document.activeElement) && document.activeElement !== document.body) return true;
  const selection = document.getSelection();
  return selection && !selection.isCollapsed && (item.element.contains(selection.anchorNode) || item.translation?.contains(selection.anchorNode));
}
export function createView(item, onOriginal, onRetry) {
  if (ownsView(item)) return item.translation;
  disposeView(item);
  const style = getComputedStyle(item.element), height = item.element.getBoundingClientRect().height;
  item.textStyle = Object.fromEntries(['fontSize','lineHeight','fontFamily','fontWeight','letterSpacing','color','textAlign'].map(k => [k, style[k]]));
  item.sourceMargins = { top: style.marginTop, bottom: style.marginBottom };
  const tag = ['TD', 'TH', 'LI'].includes(item.element.tagName) && item.placement === 'after' ? item.element.localName : 'span';
  const node = document.createElement(tag); node.className = 'clearling-translation'; node.dataset.clearling = 'translation'; node.lang = 'zh-CN'; node.dir = 'auto';
  Object.assign(node.style, item.textStyle);
  if (tag === 'td' || tag === 'th') for (const name of ['colspan','rowspan','scope','headers']) if (item.element.hasAttribute(name)) node.setAttribute(name,item.element.getAttribute(name));
  if (item.element.matches('h1,h2,h3,h4,h5,h6')) { node.setAttribute('role','heading'); node.setAttribute('aria-level', item.element.tagName[1]); }
  if (item.placement === 'after') item.element.after(node); else item.element.append(node);
  item.translation = node; item.placeholderHeight = Math.min(900, height);
  item.onOriginal = onOriginal; item.onRetry = onRetry;
  return node;
}
export function renderRichText(item, text) {
  const fragment = document.createDocumentFragment(), stack = [{ node: fragment, token: null }];
  const seen = new Set();
  for (const part of text.split(/(⟦CLR\d+_\d+⟧)/g)) {
    if (!part) continue;
    if (!/^⟦CLR\d+_\d+⟧$/.test(part)) { stack.at(-1).node.append(document.createTextNode(part)); continue; }
    if (seen.has(part) || !item.protectedValues.has(part)) throw new Error('PROTECTED_TEXT_MISSING');
    seen.add(part);
    const descriptor = item.protectedNodes?.get(part);
    if (descriptor?.type === 'open') {
      const node = document.createElement(descriptor.tag);
      for (const [key, value] of Object.entries(descriptor.attrs)) node.setAttribute(key,value);
      stack.at(-1).node.append(node); stack.push({ node, token: part });
    } else if (descriptor?.type === 'close') {
      if (stack.length < 2 || stack.at(-1).token !== descriptor.open) throw new Error('PROTECTED_TEXT_MISSING');
      stack.pop();
    } else if (descriptor?.type === 'value') {
      const node = document.createElement(descriptor.tag); node.textContent = descriptor.text; stack.at(-1).node.append(node);
    } else stack.at(-1).node.append(document.createTextNode(item.protectedValues.get(part)));
  }
  if (stack.length !== 1 || seen.size !== item.protectedValues.size) throw new Error('PROTECTED_TEXT_MISSING');
  return fragment;
}
export function present(item, mode, phase = item.phase || 'pending', content = null) {
  let node = item.translation; if (!node) return;
  if (['TD','TH','LI'].includes(item.element.tagName) && item.placement === 'after') {
    const inside = mode === 'bilingual';
    if ((node.dataset.inside === 'true') !== inside) {
      const next = document.createElement(inside ? 'span' : item.element.localName);
      for (const attribute of node.attributes) next.setAttribute(attribute.name,attribute.value);
      next.dataset.inside = String(inside); next.append(...node.childNodes);
      node.remove(); if (inside) item.element.append(next); else item.element.after(next);
      item.translation = node = next;
    }
  }
  if (content) { node.replaceChildren(content); node.style.minHeight = ''; }
  if (phase !== item.phase || !node.childNodes.length) {
    if (phase !== 'ready') {
      const status = document.createElement('span'); status.textContent = phase === 'failed' ? '暂未翻译成功' : '翻译中…';
      const original = document.createElement('button'); original.type='button'; original.textContent='查看原文'; original.onclick = e => { e.preventDefault(); e.stopPropagation(); item.onOriginal(); };
      node.replaceChildren(status, original);
      if (phase === 'failed') { const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=e=>{e.preventDefault();e.stopPropagation();item.onRetry();};node.append(retry); }
      node.style.minHeight = phase === 'pending' ? `${item.placeholderHeight}px` : '';
    }
  }
  item.phase = phase; node.dataset.phase = phase;
  const original = mode === 'original' || item.showOriginal || isInteracting(item);
  node.hidden = original || (mode === 'bilingual' && phase === 'pending');
  const hideSource = !original && mode === 'translated' && item.replaceable;
  item.element.toggleAttribute('data-cl-source', hideSource);
  node.style.setProperty('margin-top', hideSource ? item.sourceMargins.top : '.35em', 'important');
  node.style.setProperty('margin-bottom', hideSource ? item.sourceMargins.bottom : '0', 'important');
  node.dataset.mode = mode;
  node.setAttribute('aria-busy',String(phase === 'pending'));
}

export { OUTPUT };
