import { mkdir, writeFile, copyFile, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
for (const [kind, label] of [['chrome', 'Chrome'], ['ego', 'Ego']]) {
  const app = path.join(os.homedir(), 'Applications', `清译 ${label}.app`);
  try { await stat(app); throw new Error('LAUNCHER_ALREADY_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
  await mkdir(path.join(app, 'Contents/Resources'), { recursive: true });
  await writeFile(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>清译 ${label}</string><key>CFBundleDisplayName</key><string>清译 ${label}</string><key>CFBundleIdentifier</key><string>local.clearling.${kind}</string><key>CFBundleExecutable</key><string>Clearling</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundleIconFile</key><string>Clearling.png</string><key>LSUIElement</key><true/></dict></plist>`);
  const script = `#!/bin/zsh\nexec /usr/local/bin/node '${root.replaceAll("'", "'\\''")}/scripts/open-browser.mjs' ${kind}\n`;
  await writeFile(path.join(app, 'Contents/MacOS/Clearling'), script, { mode: 0o755 });
  await copyFile(path.join(root, 'dist/icons/128.png'), path.join(app, 'Contents/Resources/Clearling.png'));
  console.log(JSON.stringify({ launcher: app, browser: kind, mode: 'dedicated profile; auto-load real MV3 each launch; private CDP pipe' }));
}
