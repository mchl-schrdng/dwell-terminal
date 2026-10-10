const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { listChanges, readDiff } = require('../src/git.cjs');
const { MAX_TEXT_BYTES, quotePaths } = require('../src/files.cjs');

async function repository(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-git-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Dwell Test');
  git('config', 'user.email', 'test@example.invalid');
  return { root, git };
}

test('Changes handles non-repositories and an unborn HEAD', async (t) => {
  const { root, git } = await repository(t);
  await fs.writeFile(path.join(root, 'new.txt'), 'first\n');
  assert.equal((await readDiff(root, 'new.txt')).sections[0].label, 'Untracked');
  git('add', 'new.txt');
  const diff = await readDiff(root, 'new.txt');
  assert.equal(diff.sections[0].label, 'Staged');
  assert.match(diff.sections[0].text, /\+first/);
  await fs.rm(path.join(root, '.git'), { recursive: true });
  assert.deepEqual(await listChanges(root), { repository: false, entries: [], truncated: false });
});

test('staged and unstaged edits remain visible even when their net change cancels', async (t) => {
  const { root, git } = await repository(t);
  const filename = path.join(root, 'note.txt');
  await fs.writeFile(filename, 'original\n');
  git('add', '.');
  git('commit', '-qm', 'Initial');
  await fs.writeFile(filename, 'staged\n');
  git('add', '.');
  await fs.writeFile(filename, 'original\n');
  const diff = await readDiff(root, 'note.txt');
  assert.deepEqual(
    diff.sections.map((section) => section.label),
    ['Staged', 'Unstaged'],
  );
  assert.match(diff.sections[0].text, /\+staged/);
  assert.match(diff.sections[1].text, /-staged/);
  assert.deepEqual((await listChanges(root)).entries, [{ status: 'MM', path: 'note.txt' }]);
});

test('deleted files, renames, unusual names and opened subfolders are scoped correctly', async (t) => {
  const { root, git } = await repository(t);
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/deleted.txt'), 'goodbye\n');
  await fs.writeFile(path.join(root, 'src/old.txt'), 'rename\n');
  git('add', '.');
  git('commit', '-qm', 'Initial');
  await fs.unlink(path.join(root, 'src/deleted.txt'));
  git('mv', 'src/old.txt', 'src/new.txt');
  const unusual = "src/é ' $(whoami)\nfile.txt";
  await fs.writeFile(path.join(root, unusual), 'new\n');
  await fs.writeFile(path.join(root, 'outside.txt'), 'outside\n');
  const entries = (await listChanges(path.join(root, 'src'))).entries;
  assert(!entries.some((entry) => entry.path === 'outside.txt'));
  assert(entries.some((entry) => entry.path === path.basename(unusual)));
  assert.match((await readDiff(root, 'src/deleted.txt')).sections[0].text, /-goodbye/);
  assert.match((await readDiff(root, 'src/old.txt')).sections[0].text, /-rename/);
  assert.match((await readDiff(root, 'src/new.txt')).sections[0].text, /\+rename/);
  assert.deepEqual((await readDiff(root, unusual)).sections, [
    { label: 'Untracked', text: '+new\n+' },
  ]);
  await assert.rejects(readDiff(root, '../elsewhere'), /Invalid/);
  await assert.rejects(readDiff(root, '/etc/passwd'), /Invalid/);
  await fs.symlink(os.tmpdir(), path.join(root, 'outside-link'));
  await assert.rejects(readDiff(root, 'outside-link/missing.txt'), /outside/);
});

test('binary, oversized and long diffs are bounded', async (t) => {
  const { root, git } = await repository(t);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 255]));
  assert.match((await readDiff(root, 'binary')).reason, /binary/);
  await fs.writeFile(path.join(root, 'large.txt'), 'a'.repeat(MAX_TEXT_BYTES + 1));
  assert.match((await readDiff(root, 'large.txt')).reason, /too large/);
  await fs.writeFile(path.join(root, 'long.txt'), 'a\n'.repeat(3000));
  git('add', 'long.txt');
  const diff = await readDiff(root, 'long.txt');
  assert(diff.truncated);
  assert.equal(diff.sections[0].text.split('\n').length, 2000);
});

test('repository-defined diff, textconv and fsmonitor commands never run', async (t) => {
  const { root, git } = await repository(t);
  const marker = path.join(root, 'EXECUTED');
  const hook = path.join(root, 'unsafe.sh');
  await fs.writeFile(hook, '#!/bin/sh\ntouch "' + marker + '"\n', { mode: 0o755 });
  await fs.writeFile(path.join(root, '.gitattributes'), '*.txt diff=unsafe\n');
  await fs.writeFile(path.join(root, 'file.txt'), 'before\n');
  git('add', '.');
  git('commit', '-qm', 'Initial');
  git('config', 'diff.unsafe.command', hook);
  git('config', 'diff.unsafe.textconv', hook);
  git('config', 'core.fsmonitor', hook);
  await fs.writeFile(path.join(root, 'file.txt'), 'after\n');
  assert.match((await readDiff(root, 'file.txt')).sections[0].text, /\+after/);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});

test('dropped paths survive shell quoting without executing their contents', () => {
  const names = ["/tmp/café's screenshot.png", '/tmp/$(printf BAD)`printf BAD`;*.txt'];
  const output = execFileSync('/bin/sh', ['-c', 'printf "%s\\n" ' + quotePaths(names)], {
    encoding: 'utf8',
  });
  assert.deepEqual(output.trimEnd().split('\n'), names);
  for (const paths of [
    [],
    ['relative'],
    ['/tmp/new\nline'],
    ['/tmp/escape\x1b'],
    ['/tmp/csi\x9b'],
    ['/tmp/separator\u2028'],
    Array(33).fill('/tmp/file'),
  ])
    assert.throws(() => quotePaths(paths), /Drop up to/);
});
