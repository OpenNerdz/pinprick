// Bundles src/ into single self-contained HTML files:
//   dist/pinprick.html   full document, for the phone's Download folder and the Android app
//   dist/artifact.html   page body only, for the claude.ai artifact (its viewer adds the <head>)
// Fonts are embedded as data URIs so the game works offline.
import {build, transform} from 'esbuild';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => join(root, 'src', p);

const js = await build({
  entryPoints: [src('main.js')], bundle: true, format: 'iife', minify: true, write: false,
  target: ['es2020', 'chrome90', 'safari14'], legalComments: 'none',
});
const script = js.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1').trim();

const font = (family, weight, file) => {
  const b64 = readFileSync(join(root, 'assets/fonts', file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
};
const fonts = [
  font('Michroma', 400, 'michroma-400.woff2'),
  font('IBM Plex Mono', 400, 'plexmono-400.woff2'),
  font('IBM Plex Mono', 500, 'plexmono-500.woff2'),
].join('');
const css = (await transform(fonts + readFileSync(src('styles.css'), 'utf8'), {loader: 'css', minify: true})).code.trim();

const template = readFileSync(src('index.html'), 'utf8');
const page = template.replace('/*STYLE*/', () => css).replace('/*SCRIPT*/', () => script);

// standalone: lift the title/meta/style block into <head>, mirror the artifact viewer's reset
const split = page.indexOf('<div id="stage">');
const standalone = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#000000">\n<meta name="mobile-web-app-capable" content="yes">\n' +
  '<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n' +
  page.slice(0, split).trim() + '\n</head>\n<body>\n' + page.slice(split).trim() + '\n</body>\n</html>\n';

mkdirSync(join(root, 'dist'), {recursive: true});
writeFileSync(join(root, 'dist/artifact.html'), page);
writeFileSync(join(root, 'dist/pinprick.html'), standalone);
const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`dist/pinprick.html ${kb(standalone.length)}  (script ${kb(script.length)}, css+fonts ${kb(css.length)})`);
