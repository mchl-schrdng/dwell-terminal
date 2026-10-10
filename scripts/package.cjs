const { packager } = require('@electron/packager');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { version } = require('../package.json');
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Package Dwell on an Apple Silicon Mac.');
  const output = path.resolve(__dirname, '../release', `v${version}`);
  const bundle = path.join(output, 'Dwell-darwin-arm64/Dwell.app');
  const running = execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' });
  if (running.split('\n').some((command) => command.trim().startsWith(bundle + '/')))
    throw new Error('Close this build of Dwell before rebuilding it. Other builds can stay open.');
  const [directory] = await packager({
    dir: path.resolve(__dirname, '..'),
    name: 'Dwell',
    platform: 'darwin',
    arch: 'arm64',
    out: output,
    overwrite: true,
    appBundleId: 'local.dwell.terminal',
    appCategoryType: 'public.app-category.developer-tools',
    icon: path.resolve(__dirname, '../assets/Dwell.icns'),
    asar: { unpack: '**/node-pty/**' },
    extraResource: ['orb-notification.wav', 'claude-hook.sh', 'claude-bin'].map((name) =>
      path.resolve(__dirname, '../src', name),
    ),
    // Ship only the runtime, without caches, tests, source assets or repo metadata.
    ignore: (file) => {
      if (file.startsWith('/src/'))
        return !/^\/src\/(main|preload|orb-preload|attention|claude|files|git|workspaces)\.cjs$/.test(
          file,
        );
      return (
        file !== '' &&
        !/^\/(src$|dist(?:\/|$)|node_modules(?:\/|$)|package\.json$|LICENSE$)/.test(file)
      );
    },
    download: { cacheRoot: path.resolve(__dirname, '../.electron-cache') },
  });
  const archive = path.resolve(__dirname, '../release', `Dwell-${version}-macos-arm64.zip`);
  execFileSync('ditto', [
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
    path.join(directory, 'Dwell.app'),
    archive,
  ]);
  const checksum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive + '.sha256', `${checksum}  ${path.basename(archive)}\n`);
  console.log(archive);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
