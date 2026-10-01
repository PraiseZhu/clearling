import { mkdir, readFile, copyFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.resolve(root, process.argv[2] || 'dist');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const destination = path.join(root, 'artifacts', `clearling-${manifest.version}`);
await mkdir(path.join(destination, 'icons'), { recursive: true });
const files = ['manifest.json', 'popup.html', 'options.html', 'app.css', 'content.css', 'app.js', 'content.js', manifest.background.service_worker];
for (const file of files) await copyFile(path.join(source, file), path.join(destination, file));
for (const file of await readdir(path.join(source, 'icons'))) if (/^(16|32|48|128)\.png$/.test(file)) await copyFile(path.join(source, 'icons', file), path.join(destination, 'icons', file));
const archive = path.join(root, 'artifacts', `clearling-${manifest.version}.zip`);
execFileSync('/usr/bin/zip', ['-q', '-r', archive, '.'], { cwd: destination });
console.log(JSON.stringify({ archive, extensionDirectory: destination, version: manifest.version, includesCredentials: false }));
