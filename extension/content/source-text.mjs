// Keep host elements and their listeners intact. Only values written by this
// extension may be restored; a subsequent website edit always wins.
const projected = new WeakMap();
const ownWrites = new WeakMap();
const ownChildren = new WeakMap();
function noteChild(node,parent,kind){const queue=ownChildren.get(node)||[];queue.push({parent,kind});ownChildren.set(node,queue);}
export function isGeneratedText(node){const saved=projected.get(node);return Boolean(saved?.created&&node.parentNode===saved.parent&&node.nodeValue===saved.applied);}
export function isProjectedChildMutation(node,parent,kind){
  const queue=ownChildren.get(node),expected=queue?.shift();if(!queue?.length)ownChildren.delete(node);
  if(expected?.parent===parent&&expected.kind===kind)return true;
  ownChildren.delete(node);
  const saved=projected.get(node);
  if(kind==='remove'&&saved?.created&&saved.parent===parent){
    (saved.owner.nativeSuppressedEdges ||= new Set()).add(saved.slot);
    saved.owner.nativeChanges?.delete(node);saved.owner.nativeEdges?.delete(saved.slot);projected.delete(node);
  }
  return false;
}
function writeText(node, value) {
  if(node.nodeValue===value)return;
  const queue=ownWrites.get(node)||[];queue.push({before:node.nodeValue,after:value});ownWrites.set(node,queue);
  node.nodeValue=value;
}

export function sourceText(node) {
  const saved = projected.get(node);
  return saved && node.nodeValue === saved.applied && (saved.created?node.parentNode===saved.parent:saved.owner.element.contains(node)) ? saved.original??'' : node.nodeValue;
}

export function isProjectedMutation(node, oldValue) {
  const queue=ownWrites.get(node);
  if(arguments.length===1)return Boolean(queue?.length && node.nodeValue===queue.at(-1).after);
  const expected=queue?.shift();
  if(!queue?.length)ownWrites.delete(node);
  if(expected?.before===oldValue)return true;
  ownWrites.delete(node);
  // This includes a website explicitly writing the same translated value.
  // It is now host content and must not be restored to our older snapshot.
  projected.delete(node);
  return false;
}

export function sameTextSlots(a = [], b = []) {
  return a.length === b.length && a.every((slot, i) => slot.length === b[i].length && slot.every((node, j) => node === b[i][j]));
}

// Meaningful source line breaks are protected local values, so raw model
// newlines are formatting noise and must not create new rows in pre-wrap text.
export const nativeTranslationText = text => text.replace(/[\t ]*[\r\n]+[\t ]*/g,' ');
const edgePunctuation=(value,index,count)=>(index===0||index===count-1)&&value.trim().length<=3&&/^[\s\p{P}]+$/u.test(value);

function validateNativeSource(item) {
  for (let i = 0; i < item.textSlots.length; i++) for (let j = 0; j < item.textSlots[i].length; j++) {
    const node = item.textSlots[i][j], saved = projected.get(node);
    if (!item.element.contains(node) || saved && saved.owner !== item || sourceText(node) !== item.sourceValues[i][j]) throw new Error('SOURCE_CHANGED');
  }
  for(const node of item.nativeEdges?.values()||[]){const saved=projected.get(node);if(!saved||saved.owner!==item||node.parentNode!==item.element||node.nodeValue!==saved.applied)throw new Error('SOURCE_CHANGED');}
}

export function prepareNativeText(item, text) {
  text=nativeTranslationText(text);
  const tokens=text.match(/⟦CLR\d+_\d+⟧/g)||[];
  const expected=[...item.protectedValues.keys()];
  if(tokens.length!==expected.length || tokens.some((token,i)=>token!==expected[i]))throw new Error('PROTECTED_TEXT_MISSING');
  for (const token of tokens) if(item.protectedNodes?.get(token)?.type==='text-value')text=text.split(token).join(item.protectedValues.get(token));
  const values = text.split(/⟦CLR\d+_\d+⟧/g);
  if (values.length !== item.textSlots.length || !values.some((value,i)=>value.trim()&&item.textSlots[i]?.length) || values.some((value, i) => value.trim() && !item.textSlots[i].length && !edgePunctuation(value,i,values.length))) {
    const error=new Error('RESPONSE_INCOMPLETE');
    error.nativeMapping={slots:item.textSlots.length,parts:values.length,unbound:values.map((value,i)=>value.trim()&&!item.textSlots[i]?.length?{slot:i,length:value.length,formattingOnly:/^[\s\u200b-\u200f\u2060\ufeff]*$/.test(value)}:null).filter(Boolean).slice(0,8)};
    throw error;
  }
  // Validate every target before changing any text on the page.
  validateNativeSource(item);
  item.nativeValues = values;
}

export function applyNativeText(item) {
  if (!item.nativeValues) return;
  validateNativeSource(item);
  item.nativeChanges ||= new Map();
  item.nativeEdges ||= new Map();
  for (let i = 0; i < item.textSlots.length; i++) {
    if(item.nativeEdges.has(i) && (item.textSlots[i].length || !item.nativeValues[i].trim() || item.nativeSuppressedEdges?.has(i))){
      const node=item.nativeEdges.get(i),saved=projected.get(node);
      if(saved?.owner===item){noteChild(node,item.element,'remove');node.remove();projected.delete(node);item.nativeChanges.delete(node);}
      item.nativeEdges.delete(i);
    }
    if(!item.textSlots[i].length && item.nativeValues[i].trim() && !item.nativeSuppressedEdges?.has(i)){
      let node=item.nativeEdges.get(i),saved=node&&projected.get(node);
      if(!saved||saved.owner!==item||node.parentNode!==item.element){
        if(saved?.owner===item){projected.delete(node);item.nativeChanges.delete(node);}
        node=item.element.ownerDocument.createTextNode(item.nativeValues[i]);
        saved={owner:item,original:null,applied:item.nativeValues[i],created:true,parent:item.element,slot:i};
        item.nativeEdges.set(i,node);item.nativeChanges.set(node,saved);projected.set(node,saved);
        noteChild(node,item.element,'add');item.element.insertBefore(node,i===0?item.element.firstChild:null);
      }else{saved.applied=item.nativeValues[i];writeText(node,saved.applied);}
    }
    item.textSlots[i].forEach((node, index) => {
      const value = index ? '' : item.nativeValues[i];
      const previous = item.nativeChanges.get(node);
      const saved = previous || { owner: item, original: sourceText(node), applied: node.nodeValue };
      saved.applied = value;
      item.nativeChanges.set(node, saved); projected.set(node, saved);
      writeText(node,value);
    });
  }
}

export function restoreNativeText(item) {
  for (const [node, saved] of item.nativeChanges || []) {
    if (projected.get(node) !== saved) continue;
    if(saved.created){if(node.nodeValue===saved.applied&&node.parentNode===saved.parent){noteChild(node,saved.parent,'remove');node.remove();}}
    else if (node.nodeValue === saved.applied && item.element.contains(node)) writeText(node,saved.original);
    projected.delete(node);
  }
  item.nativeChanges?.clear();
  item.nativeEdges?.clear();
}
