const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { quotePaths } = require('../src/files.cjs');
const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + description);
}

(async () => {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-claude-input-')),
  );
  const project = path.join(temporary, 'project');
  const profile = path.join(temporary, 'profile');
  const capture = path.join(temporary, 'input');
  await fs.mkdir(project);
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, '.zshenv'), 'unsetopt GLOBAL_RCS\n');
  await fs.writeFile(
    path.join(profile, '.zshrc'),
    'PROMPT="INPUT_SHELL_READY> "\nunset HISTFILE\n',
  );
  await fs.writeFile(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ projects: {}, desktopOrb: false, notificationSound: false }),
  );
  const env = {
    ...process.env,
    DWELL_USER_DATA: profile,
    CLAUDE_CONFIG_DIR: path.join(profile, 'claude'),
    SHELL: '/bin/zsh',
    ZDOTDIR: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  let page;
  try {
    application = await electron.launch({
      executablePath: process.env.DWELL_EXECUTABLE,
      args: [...(process.env.DWELL_EXECUTABLE ? [] : [root]), '--project=' + project],
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() =>
      document.querySelector('.xterm-rows')?.textContent.includes('INPUT_SHELL_READY>'),
    );
    const id = (await page.locator('[role=tab][aria-selected=true]').getAttribute('id')).slice(4);
    await page.evaluate((id) => {
      window.inputTestOutput = '';
      window.dwell.onData(({ id: source, data }) => {
        if (source === id) window.inputTestOutput += data;
      });
    }, id);
    const scope = () => page.evaluate((id) => window.dwell.context(id), id);
    const input = (data) =>
      page.evaluate(({ id, data }) => window.dwell.input(id, data), { id, data });
    const paste = (context) => page.evaluate((value) => window.dwell.paste(value), context);
    const ask = (context, text) =>
      page.evaluate(({ context, text }) => window.dwell.askClaude(context, text), {
        context,
        text,
      });
    const menuPaste = () =>
      application.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()
          .items.flatMap((item) => item.submenu?.items || [])
          .find((item) => item.label === 'Paste');
        item.click(
          item,
          BrowserWindow.getAllWindows().find(
            (window) => window.webContents.getURL() === 'dwell://app/index.html',
          ),
        );
      });
    const output = (text) =>
      page.waitForFunction((text) => window.inputTestOutput.includes(text), text);
    let expected = '';
    async function received(text) {
      expected += text;
      await until(async () => (await fs.readFile(capture, 'utf8')) === expected, 'exact PTY input');
    }
    async function rejectsBoth(context) {
      await assert.rejects(paste(context));
      await assert.rejects(ask(context, 'Explain this selection.'));
    }
    await application.evaluate(async ({ clipboard, ClipboardItem }) => {
      global.inputTestClipboard = await Promise.all(
        (await clipboard.read())
          .filter((item) => item.types.length)
          .map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [type, await item.getType(type)]),
                  ),
                ),
              ),
          ),
      );
    });
    const image = (await fs.readFile(path.join(root, 'test/fixtures/preview.png'))).toString(
      'base64',
    );
    async function clipboardContent(text, image) {
      await application.evaluate(
        async ({ clipboard, ClipboardItem }, { text, image }) => {
          const content = { 'text/plain': text };
          if (image)
            content['image/png'] = new Blob([Buffer.from(image, 'base64')], { type: 'image/png' });
          await clipboard.write([new ClipboardItem(content)]);
          global.inputTestClipboardText = text;
        },
        { text, image },
      );
    }
    const text = 'https://example.invalid/clipboard\nUnicode café and a tab\there';
    await clipboardContent(text);
    assert.equal(await paste(await scope()), text);
    assert.equal(await paste(), text, 'text editors still receive the plain clipboard value');
    await clipboardContent('Dwell image paste fixture', image);
    assert.equal(await paste(), 'Dwell image paste fixture');
    await rejectsBoth(await scope());
    console.log(
      'PASS: text clipboard stays exact; a shell cannot receive Claude input or an image',
    );

    await input(
      quotePaths([process.execPath, path.join(root, 'test/fixtures/claude-input.cjs'), capture]) +
        '\r',
    );
    await output('CLAUDE_INPUT_READY');
    let context = await scope();
    assert.equal(await paste(context), null);
    await received('\x16');
    console.log('PASS: mixed image and text clipboard sends only raw Ctrl+V to foreground Claude');

    await application.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'dwell://app/index.html')
        .focus();
    });
    await page.locator('.xterm-helper-textarea').focus();
    await page.waitForFunction(() => document.hasFocus());
    await page.keyboard.press('Meta+v');
    await received('\x16');
    await page.locator('#new-terminal').focus();
    await menuPaste();
    await received('\x16');
    console.log('PASS: keyboard and Edit menu image paste each reach Claude exactly once');

    const selected = 'Explain café 🪴\r\n\tline\rnext\x00\x03\x1b[201~\x7f\x9b';
    assert.equal(await ask(context, selected), true);
    await received('\x1b[200~Explain café 🪴\n\tline\nnext[201~\x1b[201~');
    await assert.rejects(ask(await scope(), '\x00\x1b\x7f'));
    await assert.rejects(ask(await scope(), 'x'.repeat(65537)));
    console.log('PASS: preview context arrives as sanitized bracketed paste without submitting');

    context = await scope();
    await rejectsBoth({ ...context, revision: context.revision - 1 });
    await page.locator('#new-terminal').click();
    await page.waitForFunction(
      (id) => document.querySelector('[role=tab][aria-selected=true]')?.id !== `tab-${id}`,
      id,
    );
    await rejectsBoth(context);
    const other = (await page.locator('[role=tab][aria-selected=true]').getAttribute('id')).slice(
      4,
    );
    await page.locator(`#tab-${id}`).click();

    const delayedText = 'DWELL_PASTE_RACE_MUST_NOT_REACH_EITHER_TERMINAL';
    await clipboardContent(delayedText);
    await application.evaluate(({ clipboard, ipcMain }) => {
      global.inputTestReadText = clipboard.readText;
      clipboard.readText = async () => {
        const text = await global.inputTestReadText.call(clipboard);
        await new Promise((resolve) => (global.inputTestReleaseClipboard = resolve));
        return text;
      };
      global.inputTestPastes = [];
      global.inputTestRecord = (_event, id, data) => global.inputTestPastes.push({ id, data });
      ipcMain.on('terminal:input', global.inputTestRecord);
    });
    try {
      await menuPaste();
      await until(
        () => application.evaluate(() => Boolean(global.inputTestReleaseClipboard)),
        'pending clipboard read',
      );
      await page.locator(`#tab-${other}`).click();
      await application.evaluate(() => global.inputTestReleaseClipboard());
      await delay(150);
      assert.equal(await fs.readFile(capture, 'utf8'), expected);
      assert.equal(
        await application.evaluate(
          (_electron, text) => global.inputTestPastes.some((entry) => entry.data.includes(text)),
          delayedText,
        ),
        false,
        'a delayed paste must not reach the newly active shell or the original fixture',
      );
    } finally {
      await application.evaluate(({ clipboard, ipcMain }) => {
        clipboard.readText = global.inputTestReadText;
        global.inputTestReleaseClipboard?.();
        ipcMain.removeListener('terminal:input', global.inputTestRecord);
      });
    }
    await clipboardContent('Dwell image paste fixture', image);
    await page.locator(`#tab-${id}`).click();
    console.log('PASS: a pending text paste is discarded when the active tab changes');

    await input('\x05');
    await output('CLAUDE_INPUT_CLEAR');
    await received('\x05');
    await rejectsBoth(await scope());
    console.log('PASS: stale, inactive and cleared Claude contexts cannot receive input');

    await input('\x06');
    await output('CLAUDE_INPUT_REPORTED');
    await received('\x06');
    assert.equal(await paste(await scope()), null);
    await received('\x16');
    await input('\x04');
    await output('INPUT_SHELL_READY>');
    await received('\x04');
    await rejectsBoth(await scope());
    await delay(100);
    assert.equal(await fs.readFile(capture, 'utf8'), expected, 'rejected requests write no bytes');
    console.log('PASS: a stale Claude report cannot authorize input after returning to the shell');

    const successor = path.join(temporary, 'successor-input');
    const fixture = path.join(root, 'test/fixtures/claude-input.cjs');
    for (const wrapper of [false, true]) {
      await page.evaluate(() => (window.inputTestOutput = ''));
      const chain =
        quotePaths([process.execPath, fixture, capture]) +
        '; ' +
        quotePaths([process.execPath, fixture, successor]) +
        ' unrelated';
      await input((wrapper ? `/bin/sh -c '${chain.replaceAll("'", "'\\''")}'` : chain) + '\r');
      await output('CLAUDE_INPUT_READY');
      assert.equal(await ask(await scope(), 'Foreground check'), true);
      await until(
        async () => (await fs.readFile(capture, 'utf8')) === '\x1b[200~Foreground check\x1b[201~',
        'the original foreground process receives its draft',
      );
      await input('\x04');
      await output('CLAUDE_INPUT_UNRELATED');
      await rejectsBoth(await scope());
      await delay(100);
      assert.equal(
        await fs.readFile(successor, 'utf8'),
        '',
        'the next foreground job gets no input',
      );
      await input('\x04');
      await output('INPUT_SHELL_READY>');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: a successor foreground process cannot inherit Claude input authorization');
  } finally {
    if (application) {
      await application
        .evaluate(async ({ clipboard }) => {
          if (
            global.inputTestClipboard &&
            (await clipboard.readText()) === global.inputTestClipboardText
          ) {
            if (global.inputTestClipboard.length) await clipboard.write(global.inputTestClipboard);
            else clipboard.clear();
          }
        })
        .catch(() => {});
      await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
