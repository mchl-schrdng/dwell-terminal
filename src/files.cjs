const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_LINES = 2000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function resolveFile(root, relative = '.') {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative))
    throw new Error('Invalid file path.');
  const resolved = await fs.realpath(path.resolve(root, relative));
  const rel = path.relative(root, resolved);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    throw new Error('This link points outside the project. Open its folder separately.');
  return resolved;
}

async function listFiles(root, relative, hidden) {
  const directory = await resolveFile(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => hidden || !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(relative === '.' ? '' : relative, entry.name),
      directory: entry.isDirectory(),
      link: entry.isSymbolicLink(),
    }))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }),
    );
}

async function readPreview(root, relative) {
  const filename = await resolveFile(root, relative);
  const file = await fs.open(
    filename,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      return {
        kind: 'unsupported',
        size: stat.size,
        reason: 'Select a regular file to preview it.',
      };
    const ext = path.extname(filename).toLowerCase();
    if (IMAGE_TYPES.has(ext)) {
      if (stat.size > MAX_IMAGE_BYTES)
        return {
          kind: 'unsupported',
          size: stat.size,
          reason: 'This image is too large to preview. Open it in its default app.',
        };
      // Decode these bounded bytes, never reopen a path that may have changed.
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return { kind: 'image', size: stat.size, bytes: buffer.subarray(0, bytesRead) };
    }
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_TEXT_BYTES + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, Math.min(bytesRead, MAX_TEXT_BYTES));
    if (bytes.includes(0))
      return {
        kind: 'unsupported',
        size: stat.size,
        reason: 'A preview is not available for this file type.',
      };
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
        stream: stat.size > MAX_TEXT_BYTES,
      });
    } catch {
      return {
        kind: 'unsupported',
        size: stat.size,
        reason: 'This file is not UTF-8 text. Open it in its default app.',
      };
    }
    const lines = text.split(/\r?\n/, MAX_LINES + 1);
    return {
      kind: /\.(md|markdown)$/i.test(filename) ? 'markdown' : 'text',
      text: lines.slice(0, MAX_LINES).join('\n'),
      ext,
      size: stat.size,
      truncated: stat.size > MAX_TEXT_BYTES || lines.length > MAX_LINES,
    };
  } finally {
    await file.close();
  }
}

function friendlyError(error) {
  if (error.code === 'ENOENT') return 'This file no longer exists.';
  if (error.code === 'EACCES' || error.code === 'EPERM')
    return 'You do not have permission to read this file.';
  if (error.code === 'ENOTDIR') return 'This folder no longer exists.';
  return error.message || 'The file could not be opened.';
}

function quotePaths(paths) {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 32 ||
    paths.some(
      (filename) =>
        typeof filename !== 'string' ||
        !path.isAbsolute(filename) ||
        filename.length > 4096 ||
        /[\p{Cc}\p{Zl}\p{Zp}]/u.test(filename),
    )
  )
    throw new Error('Drop up to 32 files with paths that contain no control characters.');
  return paths.map((filename) => "'" + filename.replaceAll("'", "'\\''") + "'").join(' ') + ' ';
}

module.exports = {
  resolveFile,
  listFiles,
  readPreview,
  friendlyError,
  quotePaths,
  MAX_TEXT_BYTES,
  MAX_LINES,
  MAX_IMAGE_BYTES,
};
