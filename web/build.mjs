// Bundles the editor UI into src/Jotter/wwwroot, which the WPF host serves
// from https://app.jotter/. `node build.mjs --watch` rebuilds on change.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../src/Jotter/wwwroot');
const watch = process.argv.includes('--watch');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copyStatic() {
  fs.copyFileSync(path.join(here, 'src', 'style.css'), path.join(out, 'style.css'));
  // Version stamp on asset URLs so WebView2 never serves a stale cached copy after an update.
  const stamp = Date.now().toString(36);
  const html = fs.readFileSync(path.join(here, 'src', 'index.html'), 'utf8')
    .replace(/(href|src)="(style\.css|hljs\.css|main\.js)"/g, `$1="$2?v=${stamp}"`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  // highlight.js theme for the preview: VS 2015 (Visual Studio dark), matching the editor.
  fs.copyFileSync(path.join(here, 'node_modules/highlight.js/styles/vs2015.css'), path.join(out, 'hljs.css'));
}

copyStatic();

const options = {
  entryPoints: [path.join(here, 'src/main.js')],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: out,
  chunkNames: 'chunks/[name]-[hash]',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome120',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'static', setup: b => b.onEnd(copyStatic) }],
  });
  await ctx.watch();
} else {
  await esbuild.build(options);
}
