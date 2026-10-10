const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  listFiles,
  readPreview,
  resolveFile,
  MAX_TEXT_BYTES,
  MAX_LINES,
  MAX_IMAGE_BYTES,
} = require('../src/files.cjs');
let directory;
let root;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-files-'));
  root = path.join(directory, 'project');
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'notes.md'), '# Bonjour\nÉté — café ☕');
  await fs.writeFile(path.join(root, '.hidden'), 'hidden');
  await fs.writeFile(path.join(directory, 'outside.txt'), 'outside');
  await fs.symlink(path.join(directory, 'outside.txt'), path.join(root, 'outside-link'));
  await fs.symlink(root, path.join(root, 'loop'));
  root = await fs.realpath(root);
});
after(async () => fs.rm(directory, { recursive: true, force: true }));
test('directories sort first; hidden files are optional and symlink loops are leaves', async () => {
  const entries = await listFiles(root, '.', false);
  assert.equal(entries[0].name, 'src');
  assert(!entries.some((entry) => entry.name === '.hidden'));
  assert((await listFiles(root, '.', true)).some((entry) => entry.name === '.hidden'));
  assert.equal(entries.find((entry) => entry.name === 'loop').directory, false);
});
test('path traversal and symlinks outside the project cannot be read', async () => {
  await assert.rejects(resolveFile(root, '../outside.txt'), /outside/);
  await assert.rejects(readPreview(root, 'outside-link'), /outside/);
  await assert.rejects(resolveFile(root, '/etc/passwd'), /Invalid/);
});
test('preview rejects a parent replaced between resolution and opening', async (t) => {
  for (const restore of [false, true])
    await t.test(restore ? 'parent restored after opening' : 'parent remains a link', async (t) => {
      const parent = path.join(root, `race-${restore}`);
      const backup = parent + '-original';
      const outside = path.join(directory, `race-outside-${restore}`);
      await fs.mkdir(parent);
      await fs.mkdir(outside);
      await fs.writeFile(path.join(parent, 'note.txt'), 'Inside');
      await fs.writeFile(path.join(outside, 'note.txt'), 'Outside');
      const open = fs.open;
      let opened;
      t.mock.method(fs, 'open', async (filename, ...args) => {
        if (filename !== path.join(parent, 'note.txt')) return open(filename, ...args);
        await fs.rename(parent, backup);
        await fs.symlink(outside, parent);
        opened = await open(filename, ...args);
        if (restore) {
          await fs.unlink(parent);
          await fs.rename(backup, parent);
        }
        return opened;
      });
      await assert.rejects(
        readPreview(root, `race-${restore}/note.txt`),
        restore ? /changed while opening/ : /outside the project/,
      );
      assert.equal(opened.fd, -1, 'the rejected file descriptor is closed');
    });
});
test('UTF-8 and Markdown remain intact', async () => {
  const preview = await readPreview(root, 'notes.md');
  assert.equal(preview.kind, 'markdown');
  assert.equal(preview.text, '# Bonjour\nÉté — café ☕');
  assert.equal(preview.truncated, false);
});
test('valid replacement characters are text; malformed UTF-8 is not', async () => {
  await fs.writeFile(path.join(root, 'replacement.txt'), 'Valid \uFFFD character');
  assert.equal((await readPreview(root, 'replacement.txt')).text, 'Valid \uFFFD character');
  await fs.writeFile(path.join(root, 'malformed.txt'), Buffer.from([0xc3, 0x28]));
  assert.equal((await readPreview(root, 'malformed.txt')).kind, 'unsupported');
});
test('a multibyte character cut at the preview limit does not invalidate UTF-8', async () => {
  await fs.writeFile(path.join(root, 'boundary.txt'), 'a'.repeat(MAX_TEXT_BYTES - 1) + 'é');
  const preview = await readPreview(root, 'boundary.txt');
  assert.equal(preview.kind, 'text');
  assert.equal(preview.text.length, MAX_TEXT_BYTES - 1);
  assert(preview.truncated);
});
test('image previews return bounded bytes rather than a path to reopen', async () => {
  const bytes = Buffer.from([1, 2, 3]);
  await fs.writeFile(path.join(root, 'small.png'), bytes);
  const preview = await readPreview(root, 'small.png');
  assert.equal(preview.kind, 'image');
  assert.deepEqual(preview.bytes, bytes);
  const large = await fs.open(path.join(root, 'huge.png'), 'w');
  await large.truncate(MAX_IMAGE_BYTES + 1);
  await large.close();
  assert.equal((await readPreview(root, 'huge.png')).kind, 'unsupported');
});
test('text previews have byte and line bounds', async () => {
  await fs.writeFile(path.join(root, 'large.txt'), 'a'.repeat(MAX_TEXT_BYTES + 100));
  const large = await readPreview(root, 'large.txt');
  assert.equal(large.text.length, MAX_TEXT_BYTES);
  assert(large.truncated);
  await fs.writeFile(
    path.join(root, 'lines.txt'),
    Array.from({ length: MAX_LINES + 100 }, (_, i) => String(i)).join('\n'),
  );
  const lines = await readPreview(root, 'lines.txt');
  assert.equal(lines.text.split('\n').length, MAX_LINES);
  assert(lines.truncated);
});
test('binary and missing files do not become text previews', async () => {
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([1, 0, 255]));
  assert.equal((await readPreview(root, 'binary')).kind, 'unsupported');
  await assert.rejects(readPreview(root, 'missing.txt'), { code: 'ENOENT' });
});
