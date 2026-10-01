import { build } from 'esbuild';
import { Resvg } from '@resvg/resvg-js';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.CLEARLING_BUILD_DIR ? path.resolve(root,process.env.CLEARLING_BUILD_DIR) : path.join(root, 'dist');
await mkdir(path.join(out, 'icons'), { recursive: true });
for (const name of ['manifest.json', 'popup.html', 'options.html', 'app.css', 'content.css']) await copyFile(path.join(root, 'extension', name), path.join(out, name));
const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
await build({ entryPoints: { background: path.join(root, 'extension/background/main.mjs'), app: path.join(root, 'extension/app.mjs'), content: path.join(root, 'extension/content.js') }, outdir: out, bundle: true, format: 'esm', target: 'chrome120', minify: false, sourcemap: false, logLevel: 'warning', define: { __CLEARLING_BUILD_VERSION__: JSON.stringify(manifest.version) } });
for (const name of ['popup.html','options.html']) {
  const html = await readFile(path.join(out,name),'utf8');
  await writeFile(path.join(out,name),html.replace('src="app.js"',`src="app.js?v=${manifest.version}"`));
}
let glyph = await readFile(path.join(root, 'node_modules/lucide-static/icons/languages.svg'), 'utf8');
glyph = glyph.replace('<svg ', '<svg ').replace('stroke="currentColor"', 'stroke="#ffffff"').replace(/width="24"/, 'width="128"').replace(/height="24"/, 'height="128"');
glyph = glyph.replace(/(<svg\b[^>]*>)/, '$1<rect x="0" y="0" width="24" height="24" rx="5" fill="#216d5b" stroke="none"/><g transform="translate(3 3) scale(0.75)">').replace('</svg>', '</g></svg>');
for (const size of [16, 32, 48, 128]) await writeFile(path.join(out, 'icons', `${size}.png`), new Resvg(glyph, { fitTo: { mode: 'width', value: size } }).render().asPng());
console.log(JSON.stringify({ name: manifest.name, version: manifest.version, manifest: manifest.manifest_version, output: out }));
