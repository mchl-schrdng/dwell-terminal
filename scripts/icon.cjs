const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const iconset = path.join(assets, 'Dwell.iconset');
fs.mkdirSync(iconset, { recursive: true });
execFileSync('swift', [
  '-module-cache-path',
  path.join(root, '.swift-cache'),
  path.join(__dirname, 'icon.swift'),
  path.join(assets, 'icon.png'),
]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    execFileSync('sips', [
      '-z',
      pixels,
      pixels,
      path.join(assets, 'icon.png'),
      '--out',
      path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
    ]);
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'Dwell.icns')]);
