#!/usr/bin/env node
// Account-free interactive fixture. Git, PTYs, OSC parsing and xterm remain real.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.296 (Claude Code)');
  process.exit(0);
}
const option = (name) => args[args.lastIndexOf(name) + 1];
if (args.includes('--worktree')) {
  const settings = JSON.parse(option('--settings'));
  if (settings.worktree?.baseRef !== 'head' || settings.apiKeyHelper !== 'fixture-helper')
    throw new Error('Launcher settings were lost');
  const name = option('--worktree');
  const directory = path.join(process.cwd(), '.claude/worktrees', name);
  execFileSync('git', [
    '-c',
    'core.hooksPath=/dev/null',
    'worktree',
    'add',
    '-qb',
    `worktree-${name}`,
    directory,
    'HEAD',
  ]);
  process.chdir(directory);
}
const checkout = process.cwd();
const stored = path.join(checkout, '.claude/dwell-fixture.json');
const id = args.includes('--resume') ? option('--resume') : randomUUID();
if (
  args.includes('--resume') &&
  (!fs.existsSync(stored) || JSON.parse(fs.readFileSync(stored)).id !== id)
) {
  console.error('Conversation unavailable');
  process.exit(1);
}
fs.mkdirSync(path.dirname(stored), { recursive: true });
fs.writeFileSync(stored, JSON.stringify({ id }));
function event(hook_event_name, fields = {}) {
  const output = execFileSync('/bin/sh', [process.env.DWELL_CLAUDE_HOOK], {
    input: JSON.stringify({ hook_event_name, session_id: id, cwd: process.cwd(), ...fields }),
    encoding: 'utf8',
  });
  if (output) process.stdout.write(JSON.parse(output).terminalSequence);
}
event('SessionStart');
console.log(`FIXTURE_READY:${id}:${checkout}`);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const [command, ...rest] = line.trim().split(' ');
  const value = rest.join(' ');
  if (command === 'QUIT') {
    event('SessionEnd');
    process.exit(0);
  }
  if (command === 'EVENT') event(value);
  if (command === 'PLAN') event('PreToolUse', { tool_name: 'ExitPlanMode' });
  if (command === 'QUESTION') event('PreToolUse', { tool_name: 'AskUserQuestion' });
  if (command === 'IDLE') event('Notification', { notification_type: 'idle_prompt' });
  if (command === 'CWD') {
    process.chdir(path.resolve(checkout, value));
    event('CwdChanged', { new_cwd: process.cwd() });
  }
  if (command === 'REF') {
    event('UserPromptSubmit');
    console.log('\n' + value);
  }
  if (command === 'FULLSCREEN') {
    process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J\x1b[H');
    console.log(value);
  }
  if (command === 'NORMAL') process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l');
  if (command === 'UNRELATED') event('CwdChanged', { new_cwd: value });
  console.log('FIXTURE_INPUT:' + line);
});
