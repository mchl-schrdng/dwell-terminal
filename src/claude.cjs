const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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
  for (const event of EVENTS) {
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

async function setClaudeIntegration(directory, enabled) {
  const { filename, original, settings, mode } = await readSettings(directory);
  if (enabled && settings.disableAllHooks === true)
    throw new Error('Claude hooks are disabled by disableAllHooks in your settings.');
  const before = JSON.stringify(settings);
  const hooks = (settings.hooks ||= {});
  for (const event of EVENTS) {
    const groups = [];
    for (const group of hooks[event] || []) {
      const remaining = group.hooks.filter((hook) => !owned(hook));
      if (remaining.length === group.hooks.length) groups.push(group);
      else if (remaining.length) groups.push({ ...group, hooks: remaining });
    }
    if (enabled) groups.push({ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 2 }] });
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

module.exports = { setClaudeIntegration, isClaudeIntegrationEnabled, HOOK_COMMAND };
