const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  checkout,
  verifyCheckout,
  observeDirectory,
  newWorktree,
  restoreTabs,
} = require('../src/workspaces.cjs');
const { launchCommand, launcher, parseClaudeMessage, checkLauncher } = require('../src/claude.cjs');
const { references } = require('../src/references.cjs');
const { randomUUID } = require('node:crypto');

async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-workspaces-')),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project');
  await fs.mkdir(root);
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Dwell Test');
  git('config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(root, 'sample.txt'), 'committed\n');
  git('add', '.');
  git('commit', '-qm', 'Fixture');
  return { directory, root, git };
}

test('worktree membership uses Git identity and keeps dirty HEAD, index and files intact', async (t) => {
  const { directory, root, git } = await fixture(t);
  const linked = path.join(directory, 'linked é space');
  git('worktree', 'add', '-qb', 'worktree-test', linked, 'HEAD');
  await fs.mkdir(path.join(linked, 'src'));
  assert.equal((await verifyCheckout(root, path.join(linked, 'src'))).root, linked);
  git('worktree', 'add', '-qb', 'newline-test', path.join(directory, 'newline\nworktree'), 'HEAD');
  assert.equal((await checkout(root)).records.length, 3);
  await fs.writeFile(path.join(root, 'sample.txt'), 'staged\n');
  git('add', '.');
  await fs.appendFile(path.join(root, 'sample.txt'), 'unstaged\n');
  await fs.writeFile(path.join(root, '.env'), 'private fixture\n');
  const before = git('status', '--porcelain=v1', '-z');
  const reserved = new Set();
  const [a, b] = await Promise.all([
    newWorktree(root, root, 'Auth', reserved),
    newWorktree(root, root, 'Auth', reserved),
  ]);
  assert.notEqual(a.name, b.name);
  assert.equal(a.head, git('rev-parse', 'HEAD').trim());
  assert.equal(before, git('status', '--porcelain=v1', '-z'));
  assert.equal(await fs.readFile(path.join(root, '.env'), 'utf8'), 'private fixture\n');
  const other = path.join(directory, 'unrelated');
  await fs.mkdir(other);
  execFileSync('git', ['init', '-q', other]);
  await assert.rejects(verifyCheckout(root, other), /different repository/);
  await fs.symlink(other, path.join(root, 'escape'));
  await assert.rejects(verifyCheckout(root, path.join(root, 'escape')), /different repository/);
  for (const name of ['', 'a/b', '../task', 'task\ncommand'])
    await assert.rejects(newWorktree(root, root, name, reserved));
  await assert.rejects(
    newWorktree(path.join(linked, 'src'), path.join(linked, 'src'), 'Task', reserved),
    /repository root/,
  );
  await fs.rm(linked, { recursive: true });
  await assert.rejects(verifyCheckout(root, linked));
});

test('manual context never expands a selected subfolder and non-Git notifications still work', async (t) => {
  const { directory, root } = await fixture(t);
  const sub = path.join(root, 'src');
  await fs.mkdir(path.join(sub, 'deep'), { recursive: true });
  assert.equal((await observeDirectory(sub, path.join(sub, 'deep'))).root, sub);
  await assert.rejects(observeDirectory(sub, root), /outside the project/);
  const plain = path.join(directory, 'plain');
  await fs.mkdir(path.join(plain, 'nested'), { recursive: true });
  assert.equal((await observeDirectory(plain, path.join(plain, 'nested'))).root, plain);
  await assert.rejects(observeDirectory(plain, root));
});

test('migration preserves tab labels, exact IDs and safe metadata only', () => {
  const id = randomUUID();
  const root = '/projects/example';
  assert.equal(restoreTabs({ terminalNames: ['Auth', 'Billing'] }, root)[1].label, 'Billing');
  const [tab] = restoreTabs(
    {
      tabs: [
        {
          id,
          label: 'Auth',
          checkoutRoot: root,
          conversationId: id,
          launcher: 'a'.repeat(64),
          transcript: 'secret',
          env: 'secret',
        },
        { id, checkoutRoot: root },
      ],
    },
    root,
  );
  assert.deepEqual(tab, {
    id,
    label: 'Auth',
    checkoutRoot: root,
    conversationId: id,
    launcher: 'a'.repeat(64),
  });
  assert.equal(restoreTabs({ tabs: [{ id, checkoutRoot: '../escape' }] }, root).length, 0);
});

test('launcher arguments remain positional and exact resume never uses worktree or continue', () => {
  const id = randomUUID();
  const value = {
    command: '/with spaces/maison',
    args: ['--model', 'test$(touch /tmp/not-a-command)'],
  };
  const command = launchCommand('/bin/zsh', value, ['--resume', id]);
  assert.deepEqual(command.args.slice(2), [
    'dwell-claude',
    value.command,
    ...value.args,
    '--resume',
    id,
  ]);
  assert(!command.args.includes('--continue'));
  assert(!command.args.includes('--worktree'));
  assert.throws(() => launcher({ command: 'claude', args: ['--continue'] }));
});

test('metadata is bounded, namespaced, terminal-bound and UTF-8 validated', () => {
  const nonce = randomUUID();
  const id = randomUUID();
  const payload = `dwell;1;${nonce};SessionStart;0;none;${id};${Buffer.from('/projects/café').toString('base64')}`;
  assert.equal(parseClaudeMessage(payload, nonce).cwd, '/projects/café');
  assert.equal(parseClaudeMessage(payload, randomUUID()), null);
  for (const invalid of [
    payload.replace('dwell;1', 'dwell;2'),
    payload + ';extra',
    payload.replace('none', 'secret'),
    payload.replace('SessionStart', 'Unknown'),
    payload.replace(/[^;]+$/, Buffer.from('/a\x1b]52;attack').toString('base64')),
    'x'.repeat(6001),
  ])
    assert.equal(parseClaudeMessage(invalid, nonce), null);
});

test('references support quoted Unicode and columns, without URL/time/command guessing', () => {
  const parsed = references('at src/App.tsx:12:3 and "/folder with spaces/café.js":24:8');
  assert.deepEqual(
    parsed.map(({ path, line, column }) => ({ path, line, column })),
    [
      { path: 'src/App.tsx', line: 12, column: 3 },
      { path: '/folder with spaces/café.js', line: 24, column: 8 },
    ],
  );
  assert.equal(
    references('https://host/file.js:12 file:///tmp/a.js:1 12:30 foo:10 src/a.js:0').length,
    0,
  );
  assert.equal(references("'src/élément.js':2")[0].line, 2);
});

test(
  'worktree adapter preserves a launcher’s settings and argument boundaries',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const { directory } = await fixture(t);
    const capture = path.join(directory, 'capture');
    await fs.writeFile(
      capture,
      '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n',
      { mode: 0o700 },
    );
    const settings = {
      apiKeyHelper: '/fixture/helper with spaces',
      worktree: { symlinkDirectories: ['cache'] },
      permissions: { allow: ['Read'] },
    };
    const args = JSON.parse(
      execFileSync(
        path.join(__dirname, '../src/claude-bin/claude'),
        [
          '--plugin-dir',
          '/plugin with spaces',
          '--settings',
          JSON.stringify(settings),
          '--worktree',
          'task',
        ],
        { encoding: 'utf8', env: { ...process.env, DWELL_CLAUDE_BINARY: capture } },
      ),
    );
    assert.equal(args[1], '/plugin with spaces');
    assert.deepEqual(JSON.parse(args.at(-1)), {
      ...settings,
      worktree: { ...settings.worktree, baseRef: 'head' },
    });
  },
);

test(
  'unsupported or missing launchers fail explicitly without falling back',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const { directory } = await fixture(t);
    const command = path.join(directory, 'old-claude');
    await fs.writeFile(command, '#!/bin/sh\nprintf "2.1.141 (Claude Code)\\n"\n', { mode: 0o700 });
    await assert.rejects(
      checkLauncher('/bin/sh', { command, args: [] }, process.env, directory),
      /2.1.296/,
    );
    await assert.rejects(
      checkLauncher('/bin/sh', { command: '/missing-launcher', args: [] }, process.env, directory),
      /could not start/,
    );
  },
);
