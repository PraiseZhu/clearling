import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { BROWSERS, cdpPipe, loadCurrentExtension } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const kind = process.argv[2] || 'chrome';
const background = process.argv.includes('--background');
const browser = BROWSERS[kind];
if (!browser) throw new Error('BROWSER_KIND_INVALID');
const directory = path.join(os.homedir(), 'Library/Application Support/Clearling', kind === 'ego' ? 'ego-extension' : kind);
const stateFile = path.join(directory, 'clearling-launcher.json');
await mkdir(directory, { recursive: true, mode: 0o700 });

if (!process.argv.includes('--daemon')) {
  let existing;
  try { existing = JSON.parse(await readFile(stateFile, 'utf8')); process.kill(existing.pid, 0); } catch { existing = null; }
  if (existing?.state === 'ready') {
    const opened = spawn(browser.executable, [`--user-data-dir=${directory}`, existing.settingsUrl], { detached: true, stdio: 'ignore' }); opened.unref();
    console.log('已打开清译。');
  } else {
    const daemon = spawn(process.execPath, [fileURLToPath(import.meta.url), kind, '--daemon', ...(background ? ['--background'] : [])], { detached: true, stdio: 'ignore' }); daemon.unref();
    console.log('正在打开清译。');
  }
  process.exit(0);
}

const child = spawn(browser.executable, [
  `--user-data-dir=${directory}`, '--remote-debugging-pipe', '--no-startup-window', '--no-first-run', '--no-default-browser-check', '--disable-sync'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const cdp = cdpPipe(child.stdio[3], child.stdio[4]);
try {
  await cdp.call('Browser.getVersion', {}, undefined, 20000);
  const seed = await cdp.call('Target.createTarget', { url: 'about:blank', background: true });
  const window = await cdp.call('Browser.getWindowForTarget', { targetId: seed.targetId });
  await cdp.call('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'minimized' } });
  const id = await loadCurrentExtension(cdp, path.join(root, 'dist'));
  const settingsUrl = `chrome-extension://${id}/options.html`;
  const page = await cdp.page(settingsUrl, { hidden: false });
  await cdp.wait(page, 'document.querySelector("#model")?.options.length >= 6', 20000);
  if (!background) {
    const ownedWindow = await cdp.call('Browser.getWindowForTarget', { targetId: page.targetId });
    await cdp.call('Browser.setWindowBounds', { windowId: ownedWindow.windowId, bounds: { windowState: 'normal' } });
    await cdp.call('Page.bringToFront', {}, page.sessionId);
  }
  await writeFile(stateFile, JSON.stringify({ pid: process.pid, browserPid: child.pid, kind, extensionId: id, settingsUrl, state: 'ready', debugging: 'private pipe; no TCP listener', time: new Date().toISOString() }), { mode: 0o600 });
} catch (error) {
  await writeFile(stateFile, JSON.stringify({ pid: process.pid, kind, state: 'failed', error: String(error.message).slice(0, 160) }), { mode: 0o600 });
  await cdp.call('Browser.close').catch(() => {}); cdp.close(); child.kill('SIGTERM');
}
child.on('exit', async () => {
  cdp.close();
  try { const state = JSON.parse(await readFile(stateFile, 'utf8')); if (state.pid === process.pid) await unlink(stateFile); } catch {}
});
process.on('SIGTERM', async () => { await cdp.call('Browser.close').catch(() => {}); cdp.close(); });
