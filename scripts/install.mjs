import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, waitForInstallationWrite, loadCurrentExtension } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const kind = process.argv[2] || 'chrome';
const browser = await launchBrowser(kind);
try {
  const manager = await browser.cdp.page('chrome://extensions');
  await browser.cdp.wait(manager, '!!globalThis.chrome?.developerPrivate');
  await browser.cdp.evaluate(manager, 'chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})', true);
  const id = await loadCurrentExtension(browser.cdp, path.join(root, 'dist'));
  const inventory = await browser.cdp.call('Extensions.getExtensions');
  const extensions = inventory.extensions ?? [];
  const found = extensions.find(x => x.id === id);
  const page = await browser.cdp.page(`chrome-extension://${id}/options.html`, { hidden: false });
  await browser.cdp.wait(page, 'typeof chrome !== "undefined" && document.querySelector("#model")?.options.length >= 6');
  const manifest = await browser.cdp.evaluate(page, '({id:chrome.runtime.id,manifestVersion:chrome.runtime.getManifest().manifest_version,modelCount:document.querySelector("#model").options.length})');
  await waitForInstallationWrite(browser, id);
  const report = { browser: kind, browserName: browser.name, extensionId: id, profile: browser.directory,
    manifest, enabled: found?.enabled ?? true, registrationWritten: true, restartMode: 'startup-loader-required: Chromium removes CDP installations on restart', settingsUrl: `chrome-extension://${id}/options.html`, scope: 'dedicated Clearling test profile; existing profiles unchanged', time: new Date().toISOString() };
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await writeFile(path.join(root, 'artifacts', `install-${kind}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.cdp.call('Browser.close').catch(() => {}); browser.cdp.close(); }
