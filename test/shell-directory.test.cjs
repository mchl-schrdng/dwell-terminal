const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { foregroundDirectory, shellDirectory } = require('../src/shell-directory.cjs');

test('invalid process IDs never resolve a shell directory', async () => {
  for (const pid of [undefined, null, '1', 0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(await shellDirectory(pid, '/bin/zsh'), null);
});

test(
  'follows the foreground shell without accepting a running program cwd',
  {
    skip: process.platform !== 'darwin',
    timeout: 15000,
  },
  async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-shell-cwd-')));
    const nested = path.join(root, 'café space');
    await fs.mkdir(nested);
    // The published macOS helper can lack its executable bit before the first build.
    await fs.chmod(
      path.join(
        path.dirname(require.resolve('node-pty/package.json')),
        'prebuilds',
        `darwin-${process.arch}`,
        'spawn-helper',
      ),
      0o755,
    );
    const terminal = require('node-pty').spawn('/bin/zsh', ['-f'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: root,
      env: {
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        HOME: root,
        ZDOTDIR: root,
        PS1: 'DWELL_PROMPT>',
      },
    });
    t.after(async () => {
      terminal.kill();
      await fs.rm(root, { recursive: true, force: true });
    });
    let output = '';
    terminal.onData((data) => {
      output += data;
    });
    async function command(input, marker) {
      output = '';
      terminal.write(input + '\r');
      const deadline = Date.now() + 3000;
      while (!output.includes(marker)) {
        if (Date.now() > deadline) throw new Error('The test shell did not respond.');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await command('printf "\\x52EADY\\n"', 'READY');
    assert.equal(await shellDirectory(terminal.pid, '/bin/zsh'), root);
    await command("cd 'café space'; printf '\\x4dOVED\\n'", 'MOVED');
    assert.equal(await shellDirectory(terminal.pid, '/bin/zsh'), nested);
    await command('/bin/zsh -f', 'DWELL_PROMPT>');
    await command("cd ..; printf '\\x4eESTED\\n'", 'NESTED');
    assert.equal(await shellDirectory(terminal.pid, '/bin/zsh'), root);
    await command("printf '\\x42USY\\n'; /bin/sleep 10", 'BUSY');
    assert.equal(await shellDirectory(terminal.pid, '/bin/zsh'), null);
    assert.deepEqual(await foregroundDirectory(terminal.pid), { cwd: root, commands: ['sleep'] });
    terminal.write('\x03');
    await command('exit', 'DWELL_PROMPT>');
    await command("printf '\\x52ETURNED\\n'", 'RETURNED');
    assert.equal(await shellDirectory(terminal.pid, '/bin/zsh'), nested);
    await command('/bin/sh -c \'sleep 10 & printf "WRAP%s\\n" PER; wait\'', 'WRAPPER');
    assert.equal(
      await shellDirectory(terminal.pid, '/bin/zsh'),
      null,
      'a shell launcher with a running child is not an interactive prompt',
    );
    terminal.write('\x03');
    await command("printf '\\x53HELL\\n'", 'SHELL');
    assert.equal(await shellDirectory(terminal.pid, '/bin/zsh'), nested);
  },
);
