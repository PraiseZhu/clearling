import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceText, prepareNativeText, applyNativeText, restoreNativeText, isProjectedMutation, nativeTranslationText } from '../extension/content/source-text.mjs';
import { eligibleText, sameTranslation,nativeFragmentPlan,joinNativeFragments } from '../extension/content/planner.mjs';

const create = () => {
  const nodes=[{nodeValue:'Read '},{nodeValue:'the guide'},{nodeValue:' carefully.'}];
  const element={contains:node=>nodes.includes(node)};
  const protectedValues=new Map([['⟦CLR0_0⟧',''],['⟦CLR0_1⟧','']]);
  return {nodes,item:{element,protectedValues,textSlots:nodes.map(node=>[node]),sourceValues:nodes.map(node=>[node.nodeValue])}};
};

test('native projection preserves original text for scanning and restores the same nodes',()=>{
  const {nodes,item}=create();prepareNativeText(item,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。');applyNativeText(item);
  assert.deepEqual(nodes.map(n=>n.nodeValue),['阅读','指南','。']);
  assert.deepEqual(nodes.map(sourceText),['Read ','the guide',' carefully.']);
  assert.equal(isProjectedMutation(nodes[0]),true);
  restoreNativeText(item);assert.deepEqual(nodes.map(n=>n.nodeValue),['Read ','the guide',' carefully.']);
  assert.equal(isProjectedMutation(nodes[0]),true,'restoration echoes must not rediscover evicted records');
});

test('host edits win and a stale update is rejected before changing any other slot',()=>{
  const {nodes,item}=create();prepareNativeText(item,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。');applyNativeText(item);
  nodes[1].nodeValue='New content from the website';
  assert.equal(isProjectedMutation(nodes[1]),false);assert.equal(sourceText(nodes[1]),nodes[1].nodeValue);
  item.nativeValues=['不应写入','不应写入','不应写入'];
  assert.throws(()=>applyNativeText(item),/SOURCE_CHANGED/);assert.equal(nodes[0].nodeValue,'阅读');
  restoreNativeText(item);assert.equal(nodes[0].nodeValue,'Read ');assert.equal(nodes[1].nodeValue,'New content from the website');
});

test('two records cannot own the same native text nodes',()=>{
  const {nodes,item}=create();prepareNativeText(item,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。');applyNativeText(item);
  const other={...item,nativeChanges:undefined};
  assert.throws(()=>prepareNativeText(other,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。'),/SOURCE_CHANGED/);
  restoreNativeText(item);assert.equal(nodes[0].nodeValue,'Read ');
});

test('invalid token order and unmappable text leave the source intact',()=>{
  const {nodes,item}=create();
  assert.throws(()=>prepareNativeText(item,'阅读⟦CLR0_1⟧指南⟦CLR0_0⟧。'),/PROTECTED_TEXT_MISSING/);
  assert.throws(()=>prepareNativeText(item,'⟦CLR0_0⟧⟦CLR0_1⟧'),/RESPONSE_INCOMPLETE/);
  const leading={...item,textSlots:[[],[nodes[1]],[]],sourceValues:[[],['the guide'],[]]};
  assert.throws(()=>prepareNativeText(leading,'额外文本⟦CLR0_0⟧指南⟦CLR0_1⟧'),/RESPONSE_INCOMPLETE/);
  assert.deepEqual(nodes.map(n=>n.nodeValue),['Read ','the guide',' carefully.']);
});

test('Chinese technical headings are skipped but mixed prose and Japanese remain eligible',()=>{
  for(const text of ['自动 Build 状态： JOB_PENDING','发布 React / TypeScript API 说明','这是中文中的 cacheKey 标识'])assert.equal(eligibleText(text),false,text);
  assert.equal(eligibleText('说明：Please read the documentation before installing the extension.'),true);
  assert.equal(eligibleText('日本語の文章を読みます。'),true);
});

test('identical translations ignore whitespace and retain protected inline values',()=>{
  const tokens=new Map([['⟦CLR0_0⟧','cacheKey']]);
  assert.equal(sameTranslation('名称 ⟦CLR0_0⟧','名称  ⟦CLR0_0⟧',tokens),true);
  assert.equal(sameTranslation('Read the guide.','阅读指南。',new Map()),false);
});

test('explicit preserved line breaks map back into the same text node',()=>{
  const node={nodeValue:'First line.\nSecond line.'};
  const item={element:{contains:n=>n===node},textSlots:[[node]],sourceValues:[[node.nodeValue]],protectedValues:new Map([['⟦CLR0_0⟧','\n']]),protectedNodes:new Map([['⟦CLR0_0⟧',{type:'text-value'}]])};
  prepareNativeText(item,'第一行。⟦CLR0_0⟧第二行。');applyNativeText(item);
  assert.equal(node.nodeValue,'第一行。\n第二行。');restoreNativeText(item);assert.equal(node.nodeValue,'First line.\nSecond line.');
  assert.equal(nativeTranslationText('第一部分。\n\n 第二部分。'),'第一部分。 第二部分。');
});

test('a detached slot aborts the whole write without partially translating its siblings',()=>{
  const {nodes,item}=create();prepareNativeText(item,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。');
  item.element.contains=node=>node!==nodes[1];
  assert.throws(()=>applyNativeText(item),/SOURCE_CHANGED/);
  assert.deepEqual(nodes.map(n=>n.nodeValue),['Read ','the guide',' carefully.']);
});

test('a website write identical to a translation becomes authoritative source content',()=>{
  const {nodes,item}=create();prepareNativeText(item,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。');applyNativeText(item);
  assert.equal(isProjectedMutation(nodes[0],'Read '),true);
  nodes[0].nodeValue='阅读';
  assert.equal(isProjectedMutation(nodes[0],'阅读'),false);
  assert.equal(sourceText(nodes[0]),'阅读');restoreNativeText(item);assert.equal(nodes[0].nodeValue,'阅读');
});

test('a text node transferred to another host is no longer restored by its previous paragraph',()=>{
  const {nodes,item}=create();prepareNativeText(item,'阅读⟦CLR0_0⟧指南⟦CLR0_1⟧。');applyNativeText(item);
  item.element.contains=node=>node!==nodes[0];
  assert.equal(sourceText(nodes[0]),'阅读');restoreNativeText(item);
  assert.equal(nodes[0].nodeValue,'阅读');assert.equal(nodes[1].nodeValue,'the guide');
});

test('machine text-slot fallback preserves every local marker without sending protected values',()=>{
  const item={text:'Read ⟦CLR0_0⟧the guide⟦CLR0_1⟧ carefully.⟦CLR0_2⟧Keep ⟦CLR0_3⟧ intact.',lang:'en',protectedNodes:new Map([['⟦CLR0_0⟧',{type:'open'}],['⟦CLR0_1⟧',{type:'close'}],['⟦CLR0_2⟧',{type:'text-value'}],['⟦CLR0_3⟧',{type:'value',text:'synthetic-local-code'}]])};
  const plan=nativeFragmentPlan(item);assert.ok(plan.chunks.length>1);
  assert.ok(plan.chunks.every(chunk=>!chunk.includes('⟦CLR')&&!chunk.includes('synthetic-local-code')));
  const translated=joinNativeFragments(plan,plan.chunks.map((_,i)=>'译文'+i));
  assert.deepEqual(translated.match(/⟦CLR\d+_\d+⟧/g),item.text.match(/⟦CLR\d+_\d+⟧/g));
});
