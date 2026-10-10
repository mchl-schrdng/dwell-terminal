const { buildSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// node-pty's published macOS helper can arrive without its executable bit.
if (process.platform === 'darwin')
  fs.chmodSync(
    path.join(root, 'node_modules/node-pty/prebuilds', `darwin-${process.arch}`, 'spawn-helper'),
    0o755,
  );
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
buildSync({
  entryPoints: [path.join(root, 'src/renderer.js')],
  bundle: true,
  outfile: path.join(root, 'dist/renderer.js'),
  platform: 'browser',
  target: 'chrome140',
  minify: true,
});
for (const name of ['index.html', 'style.css', 'orb.html', 'orb.js', 'orb.css'])
  fs.copyFileSync(path.join(root, 'src', name), path.join(root, 'dist', name));
fs.copyFileSync(path.join(root, 'assets/dwell-mark.svg'), path.join(root, 'dist/dwell-mark.svg'));
const bundled = [
  '@xterm/xterm',
  '@xterm/addon-fit',
  '@xterm/addon-web-links',
  'dompurify',
  'highlight.js',
  'lucide',
  'marked',
];
const notices = bundled.map(
  (name) =>
    `${name}\n${'='.repeat(name.length)}\n${fs.readFileSync(path.join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`,
);
fs.writeFileSync(path.join(root, 'dist/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
