import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export function cdpPipe(input, output) {
  const transport = new EventTarget();
  let buffer = Buffer.alloc(0);
  transport.send = text => input.write(`${text}\0`);
  transport.close = () => input.end();
  output.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let i = buffer.indexOf(0); i !== -1; i = buffer.indexOf(0)) {
      const text = buffer.subarray(0, i).toString(); buffer = buffer.subarray(i + 1);
      if (text) transport.dispatchEvent(new MessageEvent('message', { data: text }));
    }
  });
  output.on('close', () => transport.dispatchEvent(new Event('close')));
  output.on('error', () => transport.dispatchEvent(new Event('close')));
  return new CDP(transport);
}

export const BROWSERS = {
  chrome: { executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Google Chrome' },
  ego: { executable: '/Applications/ego lite.app/Contents/MacOS/ego lite', name: 'Ego Lite' }
};

export class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.events = []; this.listeners = new Set();
    socket.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (!payload.id) { this.events.push(payload); if (this.events.length > 500) this.events.shift(); for (const listener of this.listeners) listener(payload); return; }
      const entry = this.pending.get(payload.id); if (!entry) return;
      clearTimeout(entry.timeout); this.pending.delete(payload.id);
      if (payload.error) entry.reject(new Error(`${payload.error.code}: ${payload.error.message}`)); else entry.resolve(payload.result);
    });
    socket.addEventListener('close', () => { for (const entry of this.pending.values()) { clearTimeout(entry.timeout); entry.reject(new Error('CDP_CLOSED')); } this.pending.clear(); });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP_CONNECT_FAILED')), { once: true }); });
    return new CDP(socket);
  }
  call(method, params = {}, sessionId = undefined, timeoutMs = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP_TIMEOUT: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  event(method, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const listener = payload => { if (payload.method === method && payload.sessionId === sessionId) { clearTimeout(timeout); this.listeners.delete(listener); resolve(payload.params); } };
      const timeout = setTimeout(() => { this.listeners.delete(listener); reject(new Error(`CDP_EVENT_TIMEOUT: ${method}`)); }, timeoutMs);
      this.listeners.add(listener);
    });
  }
  async page(url, { hidden = true } = {}) {
    const { targetId } = await this.call('Target.createTarget', { url, background: true, hidden });
    const { sessionId } = await this.call('Target.attachToTarget', { targetId, flatten: true });
    await this.call('Runtime.enable', {}, sessionId);
    await this.call('Page.enable', {}, sessionId);
    await this.call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
    return { targetId, sessionId };
  }
  async evaluate(page, expression, awaitPromise = false) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, page.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'EVALUATION_FAILED');
    return r.result.value;
  }
  async wait(page, expression, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(page, expression, true)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('PAGE_WAIT_TIMEOUT');
  }
  close() { this.socket.close(); }
}

export async function launchBrowser(kind, { headless = false, profileName } = {}) {
  const browser = BROWSERS[kind];
  if (!browser) throw new Error('BROWSER_KIND_INVALID');
  await stat(browser.executable);
  if (profileName && !/^(chrome|ego)-qa-[a-z0-9-]+$/.test(profileName)) throw new Error('QA_PROFILE_INVALID');
  const directory = path.join(os.homedir(), 'Library/Application Support/Clearling', profileName || (kind === 'ego' ? 'ego-extension' : kind));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const started = Date.now();
  const child = spawn(browser.executable, [
    `--user-data-dir=${directory}`, headless ? '--headless=new' : '--no-startup-window', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking', '--disable-component-update'
  ], { stdio: 'ignore', detached: true });
  child.unref();
  let code = null;
  child.on('exit', value => { code = value; });
  const deadline = Date.now() + 20000;
  let cdp;
  while (Date.now() < deadline) {
    if (code != null) throw new Error(`BROWSER_EXIT_${code}`);
    try {
      const portPath = path.join(directory, 'DevToolsActivePort');
      const info = await stat(portPath);
      if (info.mtimeMs < started - 1000) throw new Error('STALE_PORT');
      const [port, socketPath] = (await readFile(portPath, 'utf8')).trim().split('\n');
      cdp = await CDP.connect(`ws://127.0.0.1:${Number(port)}${socketPath}`);
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  if (!cdp) { try { process.kill(child.pid, 'SIGTERM'); } catch {} throw new Error('BROWSER_CDP_UNAVAILABLE'); }
  if (!headless) {
    const target = await cdp.call('Target.createTarget', { url: 'about:blank', background: true });
    const window = await cdp.call('Browser.getWindowForTarget', { targetId: target.targetId });
    await cdp.call('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'minimized' } });
  }
  return { kind, name: browser.name, directory, pid: child.pid, cdp };
}

export async function waitForInstallationWrite(browser, id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const name of ['Preferences', 'Secure Preferences']) {
      try {
        const prefs = JSON.parse(await readFile(path.join(browser.directory, 'Default', name), 'utf8'));
        if (prefs.extensions?.settings?.[id]) return;
      } catch { /* A new profile may not have written preferences yet. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('INSTALLATION_WRITE_TIMEOUT');
}

export async function loadCurrentExtension(cdp, directory) {
  const { id } = await cdp.call('Extensions.loadUnpacked', { path: directory });
  return id;
}
