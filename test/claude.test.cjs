const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  HOOK_COMMAND,
  setClaudeIntegration,
  isClaudeIntegrationEnabled,
} = require('../src/claude.cjs');

async function configuration(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-claude-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, filename: path.join(directory, 'settings.json') };
}

test('setup is idempotent, preserves user hooks and settings, and removes only Dwell hooks', async (t) => {
  const { directory, filename } = await configuration(t);
  const original = {
    preferredNotifChannel: 'notifications_disabled',
    permissions: { allow: ['Read'] },
    env: { CUSTOM: 'private value' },
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user-hook' }] }],
      PreToolUse: [{ matcher: 'Read', hooks: [] }],
      ConfigChange: [{ hooks: [{ type: 'command', command: 'echo untouched' }] }],
    },
  };
  await fs.writeFile(filename, JSON.stringify(original), { mode: 0o600 });
  assert.equal(await isClaudeIntegrationEnabled(directory), false);
  assert.equal(await setClaudeIntegration(directory, true), true);
  assert.equal(await isClaudeIntegrationEnabled(directory), true);
  const installed = await fs.readFile(filename, 'utf8');
  const modified = (await fs.stat(filename)).mtimeMs;
  assert.equal(await setClaudeIntegration(directory, true), false);
  assert.equal((await fs.stat(filename)).mtimeMs, modified);
  assert.equal(await fs.readFile(filename, 'utf8'), installed);
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);

  // A user may add a handler to our matcher group after setup.
  const shared = JSON.parse(installed);
  shared.hooks.Stop.at(-1).hooks.push({ type: 'command', command: 'echo added-later' });
  await fs.writeFile(filename, JSON.stringify(shared));
  assert.equal(await setClaudeIntegration(directory, false), true);
  original.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo added-later' }] });
  assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), original);
  assert.equal(await isClaudeIntegrationEnabled(directory), false);
  assert.equal(await setClaudeIntegration(directory, false), false);
});

test('new settings are private and settings symlinks remain intact', async (t) => {
  const { directory, filename } = await configuration(t);
  assert.equal(await isClaudeIntegrationEnabled(directory), false);
  assert.equal(await setClaudeIntegration(directory, false), false);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  await setClaudeIntegration(directory, true);
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  await setClaudeIntegration(directory, false);
  assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), {});
  const target = path.join(directory, 'actual.json');
  await fs.rename(filename, target);
  await fs.symlink(target, filename);
  await setClaudeIntegration(directory, true);
  assert((await fs.lstat(filename)).isSymbolicLink());
  assert.equal(await isClaudeIntegrationEnabled(directory), true);
  await setClaudeIntegration(directory, false);
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), {});
});

test('malformed settings and disabled hooks are never overwritten', async (t) => {
  const { directory, filename } = await configuration(t);
  for (const original of [
    '',
    '{broken',
    '[]',
    '{"hooks":[]}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[{}]}}',
    '{"disableAllHooks":true,"keep":"value"}',
  ]) {
    await fs.writeFile(filename, original);
    await assert.rejects(setClaudeIntegration(directory, true));
    assert.equal(await fs.readFile(filename, 'utf8'), original);
  }
  await fs.unlink(filename);
  await fs.symlink(path.join(directory, 'missing.json'), filename);
  await assert.rejects(setClaudeIntegration(directory, true));
  assert((await fs.lstat(filename)).isSymbolicLink());
});

test(
  'Claude events distinguish attention and API errors without treating tool failures as crashes',
  { skip: process.platform !== 'darwin' },
  () => {
    const scenarios = [
      ['SessionStart', {}, 0],
      ['SessionEnd', {}, 0],
      ['UserPromptSubmit', {}, 3],
      ['PreToolUse', { tool_name: 'Read' }, 3],
      ['PreToolUse', { tool_name: 'AskUserQuestion' }, 4],
      ['PreToolUse', { tool_name: 'ExitPlanMode' }, 4],
      ['PermissionRequest', {}, 4],
      ['PostToolUse', {}, 3],
      ['PostToolUseFailure', { error: 'command failed' }, 3],
      ['PostToolUseFailure', { is_interrupt: true }, 0],
      ['Elicitation', {}, 4],
      ['ElicitationResult', {}, 3],
      ['Stop', {}, 4],
      ['StopFailure', { error: 'rate_limit' }, 2],
      ['StopFailure', { error: 'authentication_failed' }, 2],
      ...[
        'permission_prompt',
        'idle_prompt',
        'elicitation_dialog',
        'elicitation_url_dialog',
        'agent_needs_input',
        'agent_completed',
        'quota_auto_resume_stale',
        'quota_auto_resume_disabled',
      ].map((notification_type) => ['Notification', { notification_type }, 4]),
      ...['elicitation_complete', 'elicitation_response', 'quota_auto_resume_fired'].map(
        (notification_type) => ['Notification', { notification_type }, 3],
      ),
    ];
    for (const [hook_event_name, fields, status] of scenarios) {
      const input = { hook_event_name, ...fields };
      const expected = { terminalSequence: `\x1b]9;4;${status}\x07` };
      assert.deepEqual(runHook(input), expected, JSON.stringify(input));
      assert.deepEqual(runHook({ ...input, agent_type: 'custom' }), expected);
      assert.equal(runHook({ ...input, agent_id: 'child' }), undefined);
    }
    for (const input of [
      null,
      {},
      { hook_event_name: 'SubagentStop' },
      { hook_event_name: 'Notification', notification_type: 'auth_success' },
      { hook_event_name: 'Notification', notification_type: 'future-unknown' },
    ])
      assert.equal(runHook(input), undefined);
  },
);

function runHook(input, overrides = {}) {
  const output = execFileSync('/bin/sh', ['-c', HOOK_COMMAND], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      TERM_PROGRAM: 'Dwell',
      DWELL_CLAUDE_HOOK: path.join(__dirname, '../src/claude-hook.sh'),
      ...overrides,
    },
  });
  return output ? JSON.parse(output) : undefined;
}

test(
  'the installed hook command ignores other terminals and malformed or oversized input',
  { skip: process.platform !== 'darwin' },
  () => {
    const input = { hook_event_name: 'StopFailure', error: 'private error' };
    assert.deepEqual(runHook(input), { terminalSequence: '\x1b]9;4;2\x07' });
    assert.equal(runHook(input, { TERM_PROGRAM: 'Apple_Terminal' }), undefined);
    assert.equal(runHook(input, { DWELL_CLAUDE_HOOK: '/missing-dwell' }), undefined);
    assert.equal(runHook(input, { DWELL_CLAUDE_HOOK: '' }), undefined);
    assert.equal(runHook('not json'), undefined);
    assert.equal(runHook('x'.repeat(1024 * 1024 + 1)), undefined);
  },
);
