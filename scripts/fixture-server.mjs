import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.CLEARLING_FIXTURE_PORT || 43187);
let calls = 0, rateLimitFixture = false;
const inputs = [];
const textMap = new Map([
  ['The update preserves existing settings. If validation fails, the previous configuration remains active and no changes are applied.', '更新会保留现有设置。如果验证失败，之前的配置仍然生效，不会应用任何更改。'],
  ['The project reduced duplicate requests by 25%, while preserving links, numbers, and keyboard navigation.', '项目将重复请求减少了25%，同时保留链接、数字和键盘导航。'],
  ['Dynamically added paragraphs should be translated automatically.', '动态添加的段落应自动翻译。'],
  ['When new content becomes visible, the translation should start without requiring a button click.', '新内容进入可视区时，应开始翻译，无需点击按钮。']
]);
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/failure-mode' && req.method === 'POST') {const chunks=[];for await(const c of req)chunks.push(c);try{rateLimitFixture=JSON.parse(Buffer.concat(chunks).toString()).rateLimit===true;res.end('{}');}catch{res.writeHead(400);res.end();}return;}
  if (req.url === '/metrics') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ calls, inputs })); return; }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 100000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const data = JSON.parse(input.messages[1].content); calls++;
      if(rateLimitFixture && input.model==='openai/gpt-5.6-luna'){res.setHeader('Retry-After','1');res.writeHead(429);res.end('{}');return;}
      inputs.push(...data.blocks.map(block => block.text));
      if(data.blocks.some(b=>b.text.includes('[FAIL]'))){res.writeHead(400);res.end('{}');return;}
      const translations = data.blocks.map(b => ({ id: b.id, text: textMap.get(b.text) || (process.env.CLEARLING_FIXTURE_CHINESE === '1' ? b.text.split(/(⟦CLR\d+_\d+⟧)/g).map(s=>/^⟦CLR/.test(s)?s:s.trim()?'示例中文译文，保持原有含义与阅读顺序。':'').join('') : `【测试译文】${b.text}`) }));
      const result = { clearling_test_provider: true, model: input.model, choices: [{ message: { content: JSON.stringify({ translations }) } }] };
      await new Promise(resolve => setTimeout(resolve, data.blocks.some(b => b.text.includes('[SLOW]')) ? 500 : 35)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch { res.writeHead(400); res.end('{"error":"invalid fixture request"}'); }
    return;
  }
  let file;
  if (req.url.startsWith('/scroll?')) {
    const trial = new URL(req.url, 'http://localhost').searchParams.get('trial')?.replace(/[^a-z0-9-]/gi,'').slice(0,40) || '0';
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en"><head><title>Public scrolling fixture</title><style>body{margin:0;font:16px/1.5 Arial;background:#fafafa;color:#222}main{max-width:620px;margin:auto}article{height:220px;box-sizing:border-box;padding:20px;border-bottom:1px solid #ddd} [data-testid=tweetText]{display:block} .name{height:30px}</style></head><body><main>${Array.from({length:12},(_,i)=>`<article data-testid="tweet"><div class="name" data-testid="User-Name">Public author ${i}</div><div id="row-${i}" data-testid="tweetText">Public scrolling sample ${trial}, paragraph ${i}. Reliable translation preserves links, numbers and the meaning of each sentence.</div></article>`).join('')}</main></body></html>`); return;
  }
  if (req.url === '/' || req.url === '/article' || req.url.startsWith('/article?')) file = path.join(root, 'fixtures/article.html');
  else if (req.url === '/frame') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html lang=\"en\"><body><p id=\"frame-text\">The update preserves existing settings. If validation fails, the previous configuration remains active and no changes are applied.</p></body></html>');return;}
  else if (req.url === '/x-thread') file = path.join(root, 'fixtures/x-thread.html');
  else if (/^\/icons\/(16|32|48|128)\.png$/.test(req.url)) file = path.join(root, 'dist', req.url.slice(1));
  if (!file) { res.writeHead(404); res.end(); return; }
  try { const data = await readFile(file); res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8'); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, provider: 'synthetic test provider only' })));
