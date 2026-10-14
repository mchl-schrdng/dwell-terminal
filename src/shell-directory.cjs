const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { cleanPath } = require('./workspaces.cjs');

const execute = promisify(execFile);
const shells = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'nu']);
const options = { encoding: 'utf8', timeout: 1000, maxBuffer: 16 * 1024 };

async function foregroundDirectory(pid) {
  if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const foreground = async () =>
      (await execute('/bin/ps', ['-p', String(pid), '-o', 'tpgid='], options)).stdout.trim();
    const group = await foreground();
    if (!/^[1-9]\d{0,9}$/.test(group)) return null;
    const { stdout } = await execute(
      '/usr/sbin/lsof',
      ['-a', '-p', group, '-d', 'cwd', '-Fpn0'],
      options,
    );
    const fields = stdout.split('\0').map((field) => field.replace(/^\n/, ''));
    const directory = fields.find((field) => field.startsWith('n'))?.slice(1);
    if (!fields.includes('p' + group) || !fields.includes('fcwd') || !cleanPath(directory))
      return null;
    const members = await execute('/bin/ps', ['-g', group, '-o', 'pid=,comm='], options);
    const identity = members.stdout.trim();
    const commands = members.stdout
      .split('\n')
      .filter(Boolean)
      .map((command) => path.basename(command.trim().replace(/^\d+\s+/, '')).replace(/^-/, ''));
    if (!commands.length) return null;
    // A foreground program may have replaced the shell while lsof was reading it.
    return (await foreground()) === group ? { cwd: directory, commands, identity } : null;
  } catch {
    return null;
  }
}

async function shellDirectory(pid, loginShell) {
  const current = await foregroundDirectory(pid);
  return current &&
    current.commands.every(
      (command) => shells.has(command) || command === path.basename(loginShell),
    )
    ? current.cwd
    : null;
}

module.exports = { foregroundDirectory, shellDirectory };
