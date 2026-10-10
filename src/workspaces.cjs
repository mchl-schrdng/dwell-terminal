const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { git } = require('./git.cjs');
const { resolveFile } = require('./files.cjs');

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const cleanPath = (value) =>
  typeof value === 'string' &&
  value.length <= 4096 &&
  path.isAbsolute(value) &&
  ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

async function checkout(directory) {
  const cwd = await fs.realpath(directory);
  const root = await fs.realpath(
    (await git(cwd, ['rev-parse', '--show-toplevel'])).replace(/\n$/, ''),
  );
  const common = await fs.realpath(
    (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).replace(
      /\n$/,
      '',
    ),
  );
  const listing = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  const records = listing
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const fields = record.split('\0');
      return {
        root: fields.find((field) => field.startsWith('worktree '))?.slice(9),
        branch:
          fields
            .find((field) => field.startsWith('branch '))
            ?.slice(7)
            .replace(/^refs\/heads\//, '') || 'Detached HEAD',
      };
    });
  if (records.length > 1000) throw new Error('Too many worktrees to inspect safely.');
  await Promise.all(
    records.map(async (entry) => {
      if (entry.root) entry.root = await fs.realpath(entry.root).catch(() => entry.root);
    }),
  );
  const entry = records.find((entry) => entry.root === root);
  if (!entry) throw new Error('This checkout is not registered with Git.');
  return { root, cwd, common, branch: entry.branch, records };
}

async function verifyCheckout(projectRoot, directory) {
  if (!cleanPath(directory)) throw new Error('Invalid checkout path.');
  const [project, target] = await Promise.all([checkout(projectRoot), checkout(directory)]);
  if (
    project.common !== target.common ||
    !project.records.some((entry) => entry.root === target.root)
  )
    throw new Error('This checkout belongs to a different repository.');
  return target;
}

async function observeDirectory(projectRoot, directory) {
  if (!cleanPath(directory)) throw new Error('Invalid directory.');
  const project = await checkout(projectRoot).catch((error) => {
    if (error.stderr?.includes('not a git repository')) return null;
    throw error;
  });
  if (!project || project.root !== projectRoot) {
    const cwd = await resolveFile(projectRoot, path.relative(projectRoot, directory));
    if (project && (await checkout(cwd)).common !== project.common)
      throw new Error('Unrelated repository.');
    return { root: projectRoot, cwd, branch: project?.branch || '' };
  }
  return verifyCheckout(projectRoot, directory);
}

async function newWorktree(projectRoot, directory, label, reserved) {
  if (
    typeof label !== 'string' ||
    !label.trim() ||
    label.length > 80 ||
    [...label].some(
      (char) =>
        char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error('Use a short task name without slashes or control characters.');
  const origin = await verifyCheckout(projectRoot, directory);
  if (
    origin.root !== directory ||
    (await fs.realpath(projectRoot)) !== (await checkout(projectRoot)).root
  )
    throw new Error('Open the repository root to create a Claude worktree.');
  const head = (await git(directory, ['rev-parse', '--verify', 'HEAD'])).trim();
  const slug =
    label
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'task';
  const name = `${slug}-${randomUUID().slice(0, 8)}`;
  const target = path.join(directory, '.claude/worktrees', name);
  if (
    reserved.has(name) ||
    origin.records.some((entry) => entry.root === target) ||
    (await fs.lstat(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    }))
  )
    throw new Error('That worktree name is already in use. Try again.');
  reserved.add(name);
  return { name, head, origin: directory, existing: origin.records.map((entry) => entry.root) };
}

function restoreTabs(settings, root) {
  if (!Array.isArray(settings.tabs))
    return (Array.isArray(settings.terminalNames) ? settings.terminalNames : [])
      .slice(0, 32)
      .filter((label) => typeof label === 'string')
      .map((label) => ({ id: randomUUID(), label: label.slice(0, 80), checkoutRoot: root }));
  const ids = new Set();
  return settings.tabs
    .slice(0, 32)
    .filter((tab) => {
      if (!tab || !UUID.test(tab.id) || ids.has(tab.id) || !cleanPath(tab.checkoutRoot))
        return false;
      ids.add(tab.id);
      return true;
    })
    .map((tab) => ({
      id: tab.id,
      label: typeof tab.label === 'string' ? tab.label.slice(0, 80) : 'Terminal',
      checkoutRoot: tab.checkoutRoot,
      conversationId: UUID.test(tab.conversationId) ? tab.conversationId : null,
      launcher:
        typeof tab.launcher === 'string' && /^[a-f0-9]{64}$/.test(tab.launcher)
          ? tab.launcher
          : null,
    }));
}

module.exports = {
  UUID,
  cleanPath,
  checkout,
  verifyCheckout,
  observeDirectory,
  newWorktree,
  restoreTabs,
};
