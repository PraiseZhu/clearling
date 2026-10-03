// Update the existing daily installation through its normal options/reload API.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function updateInstalled({ browser = 'chrome', id = 'iblllgfoeeoojmaceejcifkaeldmkepk', activateFast = false, opener } = {}) {
const applications = { chrome: '/Applications/Google Chrome.app', ego: '/Applications/ego lite.app' };
if (!applications[browser]) throw new Error('BROWSER_KIND_INVALID');
if (!/^[a-p]{32}$/.test(id)) throw new Error('EXTENSION_ID_INVALID');
const version = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url))).version;
const token = randomBytes(24).toString('hex');
let resolveReceipt, resolveProbe, receiptValue;
const receipt = new Promise(resolve => { resolveReceipt = resolve; });
const probe = new Promise(resolve => { resolveProbe = resolve; });
const server = http.createServer(async (req, res) => {
  if (req.url === `/clearling-probe/${token}` && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>清译安装验证</title><style>body{font:18px/1.6 Arial;max-width:600px;margin:40px auto}p{margin:30px 0}</style></head><body><main><p>Visible posts should remain readable while translation is loading. ${token.slice(0,8)}-0.</p><p>Keep numbers such as 25 and the meaning of each sentence intact. ${token.slice(0,8)}-1.</p><p>Cached translations should not require another model request. ${token.slice(0,8)}-2.</p></main><script>const timer=setInterval(()=>{const ready=[...document.querySelectorAll('[data-clearling="translation"][data-phase="ready"]')];if(ready.length===3&&ready.every(n=>n.dataset.model==='microsoft-edge')){clearInterval(timer);fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readyCount:3,readingModel:'microsoft-edge'})});}},100);</script></body></html>`); return;
  }
  const install = req.url === `/clearling-install/${token}`;
  const sample = req.url === `/clearling-probe/${token}`;
  const expectedOrigin = install ? `chrome-extension://${id}` : `http://127.0.0.1:${server.address().port}`;
  if ((!install && !sample) || req.headers.origin !== expectedOrigin) { res.writeHead(403); res.end(); return; }
  res.setHeader('Access-Control-Allow-Origin', expectedOrigin); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (install && req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id, version, activateFast })); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2000) { res.writeHead(413); res.end(); return; } }
  try {
    const data = JSON.parse(body);
    if (install && data.action === 'handshake' && Object.keys(data).length === 1) {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id, version, activateFast })); return;
    }
    if (install) {
      const allowed = ['id','version','mode','readingEngine','automatic','aiConnectionPreserved','aiModelPreserved'];
      if (Object.keys(data).some(key => !allowed.includes(key)) || data.id !== id || data.version !== version || activateFast && data.readingEngine !== 'bing') throw new Error('INVALID_RECEIPT');
      receiptValue = data; resolveReceipt(data);
    } else { if (data.readyCount !== 3 || data.readingModel !== 'microsoft-edge') throw new Error('INVALID_PROBE'); resolveProbe(data); }
    res.end('{}');
  } catch { res.writeHead(400); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const open = opener || (url => new Promise((resolve, reject) => execFile('/usr/bin/open', ['-g', '-a', applications[browser], url], error => error ? reject(error) : resolve())));
let timer, retry;
try {
  const url = `chrome-extension://${id}/options.html?install-check=${token}&port=${port}`;
  await open(url); retry = setTimeout(() => void open(url).catch(() => {}), 3000);
  const result = await Promise.race([receipt, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('INSTALL_RECEIPT_TIMEOUT')), 30000); })]);
  clearTimeout(timer); clearTimeout(retry);
  let translation = { tested: false, reason: 'reading paused by saved preferences' };
  if (result.automatic && result.mode !== 'original' && result.readingEngine === 'bing') {
    await open(`http://127.0.0.1:${port}/clearling-probe/${token}`);
    translation = await Promise.race([probe, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('INSTALL_TRANSLATION_PROBE_TIMEOUT')), 30000); })]);
  }
  const report = { host: os.hostname(), browser, ...result, translation, method: 'existing daily installation: normal runtime.reload and nonce/origin-bound receipt', time: new Date().toISOString() };
  await mkdir('artifacts', { recursive: true }); await writeFile(`artifacts/installed-${browser}-${version}.json`, JSON.stringify(report, null, 2)); return report;
} finally { clearTimeout(timer); clearTimeout(retry); server.closeAllConnections(); server.close(); }

}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
 const id = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
 console.log(JSON.stringify(await updateInstalled({ browser: process.argv[2] || 'chrome', id, activateFast: process.argv.includes('--activate-fast') })));
}
