const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { UUID, cleanPath } = require('./workspaces.cjs');
const execute = promisify(execFile);
const MIN_WORKSPACE_VERSION = '2.1.296';

// The path comes from Dwell's PTY environment, so upgrades do not leave a stale app path.
const HOOK_COMMAND =
  'if [ "$TERM_PROGRAM" = Dwell ] && [ -f "$DWELL_CLAUDE_HOOK" ]; then /bin/sh "$DWELL_CLAUDE_HOOK"; fi';
const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'Notification',
  'Elicitation',
  'ElicitationResult',
];
const WORKSPACE_EVENTS = [...EVENTS, 'CwdChanged'];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readSettings(directory) {
  let filename = path.join(directory, 'settings.json');
  let original = null;
  let mode = 0o600;
  try {
    // Preserve a user's settings symlink, replacing its target atomically instead.
    filename = await fs.realpath(filename);
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw new Error('Claude settings must be a regular file smaller than 4 MiB.');
    mode = stat.mode & 0o777;
    original = await fs.readFile(filename, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const link = await fs.lstat(filename).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (link)
      throw new Error('Claude settings could not be read; settings were left unchanged.', {
        cause: error,
      });
  }
  const settings = original === null ? {} : JSON.parse(original);
  if (!object(settings) || (settings.hooks !== undefined && !object(settings.hooks)))
    throw new Error('Claude settings or hooks are not a JSON object.');
  for (const event of WORKSPACE_EVENTS) {
    const groups = settings.hooks?.[event];
    if (
      groups !== undefined &&
      (!Array.isArray(groups) ||
        groups.some((group) => !object(group) || !Array.isArray(group.hooks)))
    )
      throw new Error(`Claude ${event} hooks are malformed; settings were left unchanged.`);
  }
  return { filename, original, settings, mode };
}

function owned(hook) {
  return hook?.type === 'command' && hook.command === HOOK_COMMAND;
}

async function isClaudeIntegrationEnabled(directory) {
  const { settings } = await readSettings(directory);
  return (
    settings.disableAllHooks !== true &&
    EVENTS.every((event) =>
      settings.hooks?.[event]?.some((group) => !group.matcher && group.hooks.some(owned)),
    )
  );
}

async function setClaudeIntegration(directory, enabled, workspaces = false) {
  const { filename, original, settings, mode } = await readSettings(directory);
  if (enabled && settings.disableAllHooks === true)
    throw new Error('Claude hooks are disabled by disableAllHooks in your settings.');
  const before = JSON.stringify(settings);
  const hooks = (settings.hooks ||= {});
  for (const event of WORKSPACE_EVENTS) {
    const groups = [];
    for (const group of hooks[event] || []) {
      const remaining = group.hooks.filter((hook) => !owned(hook));
      if (remaining.length === group.hooks.length) groups.push(group);
      else if (remaining.length) groups.push({ ...group, hooks: remaining });
    }
    if (enabled && (event !== 'CwdChanged' || workspaces))
      groups.push({ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 2 }] });
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete settings.hooks;
  if (JSON.stringify(settings) === before) return false;
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode, flag: 'wx' });
    const current = await fs.readFile(filename, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (current !== original)
      throw new Error('Claude settings changed during setup. Please try again.');
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return true;
}

function launcher(value = { command: 'claude', args: [] }) {
  if (
    !value ||
    typeof value.command !== 'string' ||
    !value.command ||
    value.command.length > 4096 ||
    [...value.command].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !Array.isArray(value.args) ||
    value.args.length > 32 ||
    value.args.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.length > 8192 ||
        [...arg].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
    )
  )
    throw new Error('Choose an executable and a JSON array of fixed arguments.');
  if (
    value.args.some(
      (arg) =>
        arg === '--' ||
        /^(--(?:worktree|resume|continue|session-id|print|background|bg|bare|safe-mode)|-[wrpc])(?:=|$)/.test(
          arg,
        ),
    )
  )
    throw new Error(
      'Dwell supplies worktree and resume options. Use an interactive Claude launcher.',
    );
  return { command: value.command, args: [...value.args] };
}

// Values are positional parameters, never interpolated shell commands. -i loads .zshrc too.
function launchCommand(shell, definition, args = [], worktree = false) {
  const configured = launcher(definition);
  return {
    file: shell,
    args: [
      '-lic',
      `${worktree ? 'export PATH="$DWELL_LAUNCH_BIN:$PATH"; ' : ''}exec "$@"`,
      'dwell-claude',
      configured.command,
      ...configured.args,
      ...args,
    ],
  };
}

async function checkLauncher(shell, definition, env, cwd) {
  const command = launchCommand(shell, definition, ['--version']);
  let stdout;
  try {
    ({ stdout } = await execute(command.file, command.args, {
      env,
      cwd,
      timeout: 30000,
      maxBuffer: 128 * 1024,
    }));
  } catch {
    throw new Error(
      'The Claude launcher could not start. Check its authentication in a normal terminal or choose another launcher.',
    );
  }
  const version = stdout.match(/(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/);
  if (
    !version ||
    Number(version[1]) < 2 ||
    (Number(version[1]) === 2 && Number(version[2]) === 1 && Number(version[3]) < 296) ||
    (Number(version[1]) === 2 && Number(version[2]) < 1)
  )
    throw new Error(
      `Claude workspaces require Claude Code ${MIN_WORKSPACE_VERSION} or later. Ordinary terminals remain available.`,
    );
  if (path.isAbsolute(definition.command) && path.basename(definition.command) === 'claude')
    return fs.realpath(definition.command);
  const { stdout: binary } = await execute(shell, ['-lic', 'command -v claude'], {
    cwd,
    env,
    timeout: 5000,
    maxBuffer: 16384,
  });
  const filename = binary.trim().split('\n').at(-1);
  if (!cleanPath(filename) || !(await fs.stat(filename)).isFile())
    throw new Error(
      'Install a Claude executable on PATH. Shell aliases and functions are not supported launchers.',
    );
  return filename;
}

function parseClaudeMessage(data, nonce) {
  if (typeof data !== 'string' || data.length > 6000) return null;
  const parts = data.split(';');
  if (
    parts.length !== 8 ||
    parts[0] !== 'dwell' ||
    parts[1] !== '1' ||
    parts[2] !== nonce ||
    !UUID.test(nonce)
  )
    return null;
  const [, , , event, status, reason, id, encoded] = parts;
  if (
    !WORKSPACE_EVENTS.includes(event) ||
    !['0', '2', '3', '4', 'keep'].includes(status) ||
    !['none', 'attention', 'approval', 'question', 'plan', 'response', 'error'].includes(reason) ||
    !UUID.test(id) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) return null;
  let cwd;
  try {
    cwd = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (!cleanPath(cwd)) return null;
  if (
    (status === 'keep') !== (event === 'CwdChanged') ||
    (status === '2') !== (reason === 'error') ||
    (status === '4') !== ['attention', 'approval', 'question', 'plan', 'response'].includes(reason)
  )
    return null;
  return { event, status: status === 'keep' ? null : Number(status), reason, id, cwd };
}

module.exports = {
  setClaudeIntegration,
  isClaudeIntegrationEnabled,
  HOOK_COMMAND,
  launcher,
  launchCommand,
  checkLauncher,
  parseClaudeMessage,
  MIN_WORKSPACE_VERSION,
};
