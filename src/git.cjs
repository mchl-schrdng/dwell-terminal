const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveFile, readPreview, MAX_TEXT_BYTES, MAX_LINES } = require('./files.cjs');

const execute = promisify(execFile);
const MAX_CHANGES = 1000;

async function git(root, args) {
  try {
    const { stdout } = await execute(
      'git',
      ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd: root,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
        encoding: 'utf8',
        maxBuffer: MAX_TEXT_BYTES,
        timeout: 5000,
      },
    );
    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Install Git to view changes.', { cause: error });
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      throw new Error('These changes are too large to preview in Dwell.', { cause: error });
    if (error.killed)
      throw new Error('Git took too long. Try refreshing Changes.', { cause: error });
    throw error;
  }
}

async function listChanges(root) {
  if (!root) throw new Error('Open a folder first.');
  let repository;
  try {
    repository = (await git(root, ['rev-parse', '--show-toplevel'])).replace(/\n$/, '');
  } catch (error) {
    if (error.stderr?.includes('not a git repository'))
      return { repository: false, entries: [], truncated: false };
    throw error;
  }
  const status = await git(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=all',
    '--no-renames',
    '--',
    '.',
  ]);
  const entries = status
    .split('\0')
    .filter(Boolean)
    .map((record) => ({
      status: record.slice(0, 2),
      path: path.relative(root, path.join(repository, record.slice(3))),
    }))
    .filter(
      (entry) =>
        entry.path &&
        entry.path !== '..' &&
        !entry.path.startsWith('..' + path.sep) &&
        !path.isAbsolute(entry.path),
    );
  return {
    repository: true,
    entries: entries.slice(0, MAX_CHANGES),
    truncated: entries.length > MAX_CHANGES,
  };
}

async function readDiff(root, relative) {
  if (
    !root ||
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\0') ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes('..')
  )
    throw new Error('Invalid file path.');
  // Deleted files have no realpath; validate their nearest existing parent instead.
  let parent = relative;
  while (true) {
    try {
      await resolveFile(root, parent);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' || parent === '.') throw error;
      parent = path.dirname(parent);
    }
  }
  const { entries } = await listChanges(root);
  const entry = entries.find((entry) => entry.path === relative);
  if (!entry) return { sections: [], truncated: false };
  const filename = path.join(root, relative);
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile())
      return {
        sections: [],
        reason: 'Only regular file changes can be previewed.',
        truncated: false,
      };
    if (stat.size > MAX_TEXT_BYTES)
      return {
        sections: [],
        reason: 'This file is too large to preview in Changes.',
        truncated: false,
      };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entry.status === '??') {
    const preview = await readPreview(root, relative);
    if (!['text', 'markdown'].includes(preview.kind))
      return {
        sections: [],
        reason: 'New binary file. Use Files to preview it.',
        truncated: false,
      };
    return {
      sections: [
        {
          label: 'Untracked',
          text: preview.text
            .split('\n')
            .map((line) => '+' + line)
            .join('\n'),
        },
      ],
      truncated: preview.truncated,
    };
  }
  const options = [
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--no-renames',
    '--ignore-submodules=all',
    '--unified=3',
  ];
  const [staged, unstaged] = await Promise.all([
    git(root, ['diff', '--cached', ...options, '--', relative]),
    git(root, ['diff', ...options, '--', relative]),
  ]);
  let remaining = MAX_LINES;
  let remainingBytes = MAX_TEXT_BYTES;
  let truncated = false;
  const sections = [];
  for (const [label, text] of [
    ['Staged', staged],
    ['Unstaged', unstaged],
  ]) {
    if (!text) continue;
    const bytes = Buffer.from(text);
    if (bytes.length > remainingBytes) truncated = true;
    const bounded = new TextDecoder('utf-8').decode(bytes.subarray(0, remainingBytes), {
      stream: bytes.length > remainingBytes,
    });
    remainingBytes = Math.max(0, remainingBytes - bytes.length);
    const lines = bounded.replace(/\n$/, '').split('\n');
    if (lines.length > remaining) truncated = true;
    sections.push({ label, text: lines.slice(0, remaining).join('\n') });
    remaining = Math.max(0, remaining - lines.length);
  }
  return { sections, truncated };
}

module.exports = { listChanges, readDiff };
