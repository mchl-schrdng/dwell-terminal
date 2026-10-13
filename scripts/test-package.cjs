const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { version } = require('../package.json');

assert.equal(process.platform, 'darwin', 'Package verification requires macOS.');
const name = `Dwell-${version}-macos-arm64.zip`;
const archive = path.resolve(__dirname, '../release', name);
const checksum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
assert.equal(fs.readFileSync(archive + '.sha256', 'utf8'), `${checksum}  ${name}\n`);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dwell-package-test-'));
try {
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, temporary]);
  const bundle = path.join(temporary, 'Dwell.app');
  const verify = () =>
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
      stdio: 'pipe',
    });
  verify();
  console.log('PASS: release checksum and extracted bundle signature');
  fs.appendFileSync(path.join(bundle, 'Contents/Resources/claude-hook.sh'), '\n# changed\n');
  assert.throws(
    verify,
    (error) => /a sealed resource is missing or invalid/.test(String(error.stderr)),
    'the signature must reject a changed runtime resource',
  );
  console.log('PASS: signature rejects a modified runtime resource');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
