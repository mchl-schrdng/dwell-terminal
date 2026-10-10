const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { quotePaths } = require('../src/files.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out: ' + description);
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-test-')));
  await fs.mkdir(path.join(fixture, 'src'), { recursive: true });
  await fs.mkdir(path.join(fixture, 'docs'), { recursive: true });
  await fs.writeFile(
    path.join(fixture, 'src/App.tsx'),
    'export default function App() {\n  return <main>One thing at a time.</main>;\n}\n',
  );
  await fs.writeFile(
    path.join(fixture, 'src/styles.css'),
    'body {\n  color: #e5e5e7;\n  background: #17181a;\n}\n',
  );
  await fs.writeFile(
    path.join(fixture, 'README.md'),
    '# My project\n\nA quiet workspace for focused work.\n\n## Getting started\n\n```sh\nnpm install\nnpm run dev\n```\n',
  );
  await fs.writeFile(
    path.join(fixture, 'docs/unsafe.md'),
    '# Safe preview\n<script>window.previewExecuted = true</script>\n<img src="https://example.com/tracker" onerror="window.previewExecuted = true">\n[Bad link](javascript:alert(1))',
  );
  await fs.writeFile(path.join(fixture, '.hidden'), 'hidden');
  await fs.copyFile(path.join(root, 'test/fixtures/preview.png'), path.join(fixture, 'image.png'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Dwell Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'Initial fixture');
  const profile = await fs.mkdtemp(path.join(output, 'profile-'));
  await fs.writeFile(path.join(profile, '.zshenv'), 'unsetopt GLOBAL_RCS\n');
  await fs.writeFile(
    path.join(profile, '.zshrc'),
    "PROMPT='DWELL_TEST_READY> '\nRPROMPT=''\nunset HISTFILE\n",
  );
  const env = { ...process.env, DWELL_USER_DATA: profile, SHELL: '/bin/zsh', ZDOTDIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  let page;
  try {
    const executablePath = process.env.DWELL_EXECUTABLE;
    application = await electron.launch({
      executablePath,
      args: [...(executablePath ? [] : [root]), '--project=' + fixture],
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.xterm-helper-textarea');
    await page.waitForSelector('[data-path="src"]');
    await application.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'dwell://app/index.html')
        .focus();
    });
    await page.waitForFunction(
      () =>
        document.hasFocus() &&
        document.querySelector('.xterm-rows')?.textContent.includes('DWELL_TEST_READY>'),
    );
    await page.evaluate(() => {
      window.testOutput = '';
      window.testOutputs = {};
      window.dwell.onData(({ id, data }) => {
        window.testOutput += data;
        window.testOutputs[id] = (window.testOutputs[id] || '') + data;
      });
    });
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type("printf 'DWELL_%s\\n' 'PTY_OK'");
    await page.keyboard.press('Enter');
    await until(
      () => page.evaluate(() => window.testOutput.includes('DWELL_PTY_OK')),
      'real terminal output',
    );
    console.log('PASS: real PTY and keyboard input');
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', "printf 'PASTE_%s\\n' 'café ✓'\nprintf 'SECOND_%s\\n' 'LINE'");
      document
        .querySelector('.xterm-helper-textarea')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    await page.keyboard.press('Enter');
    await until(
      () =>
        page.evaluate(
          () =>
            window.testOutput.includes('PASTE_café ✓') && window.testOutput.includes('SECOND_LINE'),
        ),
      'Unicode multiline paste',
    );
    await page.keyboard.type('sleep 30');
    await page.keyboard.press('Enter');
    await delay(400);
    await page.keyboard.press('Control+c');
    await page.keyboard.type("printf 'INTERRUPT_%s\\n' 'OK'");
    await page.keyboard.press('Enter');
    await until(
      () => page.evaluate(() => window.testOutput.includes('INTERRUPT_OK')),
      'Ctrl+C interrupts a running program',
    );
    console.log('PASS: Unicode, multiline paste and Ctrl+C');

    const activeInput = () =>
      page.locator('.terminal-session:not([hidden]) .xterm-helper-textarea');
    const activeId = () =>
      page
        .locator('.terminal-session:not([hidden])')
        .getAttribute('id')
        .then((id) => id.slice(8));
    const hasOutput = (id, text) =>
      page.evaluate(({ id, text }) => (window.testOutputs[id] || '').includes(text), { id, text });
    const command = async (text) => {
      await page.waitForFunction(() =>
        document
          .querySelector('.terminal-session:not([hidden]) .xterm-rows')
          ?.textContent.includes('DWELL_TEST_READY>'),
      );
      await activeInput().focus();
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    };
    // Playwright's synthetic keys bypass native macOS menu accelerators.
    const menuAction = async (label, accelerator) => {
      assert.equal(
        await application.evaluate(({ Menu, BrowserWindow }, label) => {
          const item = Menu.getApplicationMenu()
            .items.flatMap((item) => item.submenu?.items || [])
            .find((item) => item.label === label);
          item.click(
            item,
            BrowserWindow.getAllWindows().find(
              (window) => window.webContents.getURL() === 'dwell://app/index.html',
            ),
          );
          return item.accelerator;
        }, label),
        accelerator,
      );
    };
    const pasteUrl = 'https://github.com/mchl-schrdng/dwell-terminal';
    await application.evaluate(async ({ clipboard, ClipboardItem }) => {
      global.savedClipboard = await Promise.all(
        (await clipboard.read())
          .filter((item) => item.types.length > 0)
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
    try {
      await page.evaluate((text) => window.dwell.copy(text), pasteUrl);
      assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), pasteUrl);
      for (const mode of ['menu', 'keyboard']) {
        await command(`read -r pasted; printf '${mode}_URL=<%s>\\n' "$pasted"`);
        const outputStart = await page.evaluate(() => window.testOutput.length);
        if (mode === 'menu') {
          await page.locator('#new-terminal').focus();
          await menuAction('Paste', 'CmdOrCtrl+V');
        } else {
          await page.keyboard.press('Meta+v');
        }
        await until(
          () => activeInput().evaluate((element) => element === document.activeElement),
          'paste focuses the terminal',
        );
        await until(
          () =>
            page.evaluate(({ start, text }) => window.testOutput.slice(start).includes(text), {
              start: outputStart,
              text: pasteUrl,
            }),
          'clipboard text reaches the PTY before Enter',
        );
        await page.keyboard.press('Enter');
        await until(
          () =>
            page.evaluate(({ text, mode }) => window.testOutput.includes(`${mode}_URL=<${text}>`), {
              text: pasteUrl,
              mode,
            }),
          `${mode} paste delivers the exact URL once`,
        );
      }
      await page.getByRole('tab').dblclick();
      await menuAction('Paste', 'CmdOrCtrl+V');
      await until(
        async () =>
          (await page.getByRole('textbox', { name: 'Terminal name' }).inputValue()) === pasteUrl,
        'menu paste targets the tab name editor',
      );
      await page.getByRole('textbox', { name: 'Terminal name' }).press('Escape');
    } finally {
      await application.evaluate(async ({ clipboard }, text) => {
        if ((await clipboard.readText()) === text) {
          if (global.savedClipboard.length) await clipboard.write(global.savedClipboard);
          else clipboard.clear();
        }
        delete global.savedClipboard;
      }, pasteUrl);
    }
    console.log('PASS: menu and keyboard paste deliver a URL');
    const firstId = await activeId();
    await command("export DWELL_TEST_VALUE=first; cd src; printf 'FIRST_%s\\n' 'READY'");
    await until(
      () => hasOutput(firstId, 'FIRST_READY'),
      'first shell changes its environment and directory',
    );
    await page.keyboard.type("printf 'DRAFT_%s\\n' 'KEPT'");
    await page.locator('#new-terminal').click();
    await until(async () => (await page.getByRole('tab').count()) === 2, 'second terminal opens');
    const secondId = await activeId();
    await command(
      'printf \'SECOND_ENV_%s\\nSECOND_DIR_%s\\n\' "${DWELL_TEST_VALUE:-empty}" "$PWD"',
    );
    await until(() => hasOutput(secondId, 'SECOND_ENV_empty'), 'independent shell environment');
    assert(await hasOutput(secondId, 'SECOND_DIR_' + fixture));
    await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
    await page.keyboard.press('Enter');
    await until(() => hasOutput(firstId, 'DRAFT_KEPT'), 'unfinished input survives a tab switch');
    assert.equal(await hasOutput(secondId, 'DRAFT_KEPT'), false);
    await command(
      "sleep 0.3; jot -b BACKGROUND_BLOCK........................................................ 16000; printf 'BACKGROUND_%s\\n' 'DONE'",
    );
    await page.getByRole('tab', { name: 'Terminal 2', exact: true }).click();
    await command("printf 'FOREGROUND_%s\\n' 'READY'");
    await until(
      () => hasOutput(firstId, 'BACKGROUND_DONE'),
      'large output drains in an inactive terminal',
    );
    await until(() => hasOutput(secondId, 'FOREGROUND_READY'), 'foreground stays responsive');
    assert.equal(await hasOutput(secondId, 'BACKGROUND_DONE'), false);
    assert(await activeInput().evaluate((element) => element === document.activeElement));

    await application.evaluate(({ dialog }) => {
      global.originalDialog = dialog.showMessageBox;
      global.testDialogCount = 0;
      dialog.showMessageBox = async () => {
        global.testDialogCount++;
        return { response: 0 };
      };
    });
    await page.getByRole('button', { name: 'Close Terminal 2', exact: true }).click();
    await until(
      () => application.evaluate(() => global.testDialogCount === 1),
      'closing a live terminal asks for confirmation',
    );
    assert.equal(await page.getByRole('tab').count(), 2);
    await command("printf 'CANCEL_%s\\n' 'ALIVE'");
    await until(() => hasOutput(secondId, 'CANCEL_ALIVE'), 'cancel keeps the session alive');
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page.getByRole('button', { name: 'Close Terminal 2', exact: true }).click();
    await until(
      async () => (await page.getByRole('tab').count()) === 1,
      'confirmed close removes only the selected terminal',
    );
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = global.originalDialog;
    });
    assert.equal(await activeId(), firstId);
    await command('printf \'SURVIVOR_%s_%s\\n\' "$DWELL_TEST_VALUE" "${PWD##*/}"');
    await until(
      () => hasOutput(firstId, 'SURVIVOR_first_src'),
      'other shell survives with its environment and directory',
    );
    await command('cd ..; unset DWELL_TEST_VALUE');
    console.log(
      'PASS: independent terminals, retained input, background output and safe tab closing',
    );

    await page.locator('[data-path="src"]').click();
    await page.locator('[data-path="src/App.tsx"]').click();
    await page.waitForSelector('.source-line');
    assert((await page.locator('#preview-content').innerText()).includes('One thing at a time.'));
    assert(
      await page
        .locator('.xterm-helper-textarea')
        .evaluate((element) => element === document.activeElement),
    );
    await fs.writeFile(
      path.join(fixture, 'src/App.tsx'),
      'export default function App() {\n  return <main>Updated on disk — café.</main>;\n}\n',
    );
    await until(
      async () =>
        (await page.locator('#preview-content').innerText()).includes('Updated on disk — café.'),
      'live preview refresh',
    );
    assert(
      await page
        .locator('.xterm-helper-textarea')
        .evaluate((element) => element === document.activeElement),
    );
    await fs.writeFile(path.join(fixture, 'src/new.txt'), 'new file');
    await page.waitForSelector('[data-path="src/new.txt"]');
    console.log('PASS: file tree, live changes and terminal focus');

    git('add', 'src/App.tsx');
    await fs.writeFile(
      path.join(fixture, 'src/App.tsx'),
      'export default function App() {\n  return <main>Ready for review.</main>;\n}\n',
    );
    await page.locator('#show-changes').click();
    await page.locator('.change-row[data-path="src/App.tsx"]').click();
    await until(
      async () => (await page.locator('.diff-heading').count()) === 2,
      'staged and unstaged diff sections',
    );
    assert.deepEqual(await page.locator('.diff-heading').allTextContents(), ['Staged', 'Unstaged']);
    assert(
      (await page.locator('.diff-line.added').allTextContents()).some((line) =>
        line.includes('Ready for review.'),
      ),
    );
    assert(await page.locator('#toggle-source').isHidden());
    const unchangedIndex = git('diff', '--cached');
    await fs.writeFile(path.join(fixture, 'docs/new-change.txt'), 'Created while Changes is open.');
    await page.waitForSelector('.change-row[data-path="docs/new-change.txt"]');
    await page.locator('.change-row[data-path="docs/new-change.txt"]').click();
    await until(
      async () =>
        (await page.locator('#preview-content').innerText()).includes(
          'Created while Changes is open.',
        ),
      'untracked diff',
    );
    await fs.unlink(path.join(fixture, 'src/styles.css'));
    await page.waitForSelector('.change-row[data-path="src/styles.css"]');
    await page.locator('.change-row[data-path="src/styles.css"]').click();
    await until(
      async () => (await page.locator('.diff-line.removed').count()) > 0,
      'deleted file diff',
    );
    assert.equal(git('diff', '--cached'), unchangedIndex);
    await page.locator('.change-row[data-path="src/App.tsx"]').click();
    await until(
      async () => (await page.locator('.diff-heading').count()) === 2,
      'diff ready for screenshot',
    );
    await command('clear');
    await page.screenshot({ path: path.join(output, 'dwell-changes.png') });
    await page.locator('#show-files').click();
    await page.waitForSelector('[data-path="src/App.tsx"]');
    console.log('PASS: live Git changes, staged/unstaged, new/deleted files and read-only index');

    await command("read -r reference; printf 'DROPPED_%s=<%s>\\n' 'INTERNAL' \"$reference\"");
    await page.locator('[data-path="src/App.tsx"]').dragTo(page.locator('#terminal'));
    const internalReference = quotePaths([path.join(fixture, 'src/App.tsx')]).trimEnd();
    await until(() => hasOutput(firstId, internalReference), 'tree drop inserts the file path');
    await delay(200);
    assert.equal(await hasOutput(firstId, 'DROPPED_INTERNAL=<'), false);
    await page.keyboard.press('Enter');
    await until(
      () => hasOutput(firstId, 'DROPPED_INTERNAL=<' + internalReference + '>'),
      'tree drop waits for Enter',
    );
    const external = path.join(profile, "screen's café.png");
    await fs.writeFile(external, 'fixture');
    await command("read -r reference; printf 'DROPPED_%s=<%s>\\n' 'EXTERNAL' \"$reference\"");
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'test-drop';
      input.hidden = true;
      document.body.append(input);
    });
    await page.locator('#test-drop').setInputFiles(external);
    await page.evaluate(() => {
      const input = document.querySelector('#test-drop');
      const data = new DataTransfer();
      data.items.add(input.files[0]);
      document
        .querySelector('#terminal')
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
        );
      input.remove();
    });
    const externalReference = quotePaths([external]).trimEnd();
    await until(
      () => hasOutput(firstId, externalReference),
      'native file drop resolves and quotes the absolute path',
    );
    assert.equal(await hasOutput(firstId, 'DROPPED_EXTERNAL=<'), false);
    await page.keyboard.press('Enter');
    await until(
      () => hasOutput(firstId, 'DROPPED_EXTERNAL=<' + externalReference + '>'),
      'external drop waits for Enter',
    );
    console.log('PASS: tree and native file drops, quoting and no automatic submission');

    const enableOrb = (checked) =>
      application.evaluate(async ({ Menu }, checked) => {
        const item = Menu.getApplicationMenu().getMenuItemById('desktop-orb');
        if (item.checked !== checked) await item.click(item);
      }, checked);
    assert.equal(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    await enableOrb(true);
    await until(
      () =>
        Promise.resolve(application.windows().some((window) => window.url().endsWith('/orb.html'))),
      'desktop orb opens',
    );
    const orb = application.windows().find((window) => window.url().endsWith('/orb.html'));
    await orb.waitForSelector('#orb');
    await until(
      () =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.getTitle() === 'Dwell Desktop Orb')
            ?.isVisible(),
        ),
      'orb becomes visible',
    );
    const edgePosition = await application.evaluate(({ screen, BrowserWindow }) => {
      global.originalCursorPoint = screen.getCursorScreenPoint;
      global.orbTestCursor = { x: 0, y: 0 };
      screen.getCursorScreenPoint = () => global.orbTestCursor;
      const bounds = BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'Dwell Desktop Orb')
        .getBounds();
      const area = screen.getDisplayNearestPoint({
        x: bounds.x + 10000,
        y: bounds.y + 10000,
      }).workArea;
      return [area.x + area.width - 88, area.y + area.height - 88];
    });
    await orb.evaluate(() => window.orb.drag('start'));
    await application.evaluate(() => {
      global.orbTestCursor = { x: 10000, y: 10000 };
    });
    await orb.evaluate(() => window.orb.drag('move'));
    await until(
      async () =>
        JSON.stringify(
          await application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.getTitle() === 'Dwell Desktop Orb')
              .getPosition(),
          ),
        ) === JSON.stringify(edgePosition),
      'orb dragging stays in the display work area',
    );
    await orb.evaluate(() => window.orb.drag('end'));
    // macOS can nudge windows at the Dock boundary when they are recreated.
    const orbPosition = edgePosition.map((coordinate) => coordinate - 32);
    await orb.evaluate(() => window.orb.drag('start'));
    await application.evaluate(() => {
      global.orbTestCursor = { x: 9968, y: 9968 };
    });
    await orb.evaluate(() => window.orb.drag('move'));
    await until(
      async () =>
        JSON.stringify(
          await application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.getTitle() === 'Dwell Desktop Orb')
              .getPosition(),
          ),
        ) === JSON.stringify(orbPosition),
      'orb moves away from the display edge',
    );
    await orb.evaluate(() => window.orb.drag('end'));
    await until(
      async () =>
        JSON.stringify(
          JSON.parse(await fs.readFile(path.join(profile, 'preferences.json'), 'utf8')).orbPosition,
        ) === JSON.stringify({ x: orbPosition[0], y: orbPosition[1] }),
      'orb position is saved',
    );
    await application.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = global.originalCursorPoint;
    });
    const dustImage = () => orb.locator('#orb-dust').evaluate((canvas) => canvas.toDataURL());
    const firstDustFrame = await dustImage();
    await until(async () => (await dustImage()) !== firstDustFrame, 'desktop dust moves');
    await orb.emulateMedia({ reducedMotion: 'reduce' });
    await delay(100);
    const stillDust = await dustImage();
    await delay(180);
    assert.equal(await dustImage(), stillDust, 'reduced motion leaves a still cloud');
    const dustWarmth = () =>
      orb.locator('#orb-dust').evaluate((canvas) => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let warmth = 0;
        for (let i = 0; i < pixels.length; i += 4)
          warmth += (pixels[i] - pixels[i + 2]) * pixels[i + 3];
        return warmth;
      });
    assert((await dustWarmth()) < 0, 'idle dust is cool');
    assert(await page.evaluate(() => document.hasFocus()));
    await command("sleep 0.6; printf '\\a'");
    await page.locator('#new-terminal').click();
    await until(
      async () => (await page.locator('.needs-attention').count()) === 1,
      'BEL marks the background tab',
    );
    await orb.waitForSelector('#orb.attention');
    await until(async () => (await dustWarmth()) > 0, 'attention dust becomes warm without motion');
    // A repeated bell is coalesced; the orb counts terminals, not individual alerts.
    await page.evaluate((id) => {
      window.dwell.bell(id, 'Terminal 1');
      window.dwell.bell(id, 'Terminal 1');
    }, firstId);
    assert.equal(await orb.locator('#orb-count').textContent(), '1');
    assert.deepEqual(
      await orb.evaluate(() => ({ bridge: typeof window.dwell, node: typeof window.require })),
      { bridge: 'undefined', node: 'undefined' },
    );
    const attentionSecondId = await activeId();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'dwell://app/index.html')
        .hide(),
    );
    await page.evaluate((id) => window.dwell.bell(id, 'Terminal 3'), attentionSecondId);
    await until(
      async () => (await orb.locator('#orb-count').textContent()) === '2',
      'orb queues both terminals',
    );
    await orb.screenshot({ path: path.join(output, 'dwell-orb.png'), omitBackground: true });
    await orb.locator('#orb').click();
    await until(async () => (await activeId()) === firstId, 'orb returns to the alerting terminal');
    await until(
      async () => (await page.locator('.needs-attention').count()) === 1,
      'opening one terminal preserves the other pending alert',
    );
    await orb.locator('#orb').click();
    await until(
      async () => (await activeId()) === attentionSecondId,
      'second orb click opens the next pending terminal',
    );
    await until(
      async () => !(await orb.locator('#orb').getAttribute('class')).includes('attention'),
      'orb returns to idle',
    );
    await until(async () => (await dustWarmth()) < 0, 'acknowledged dust returns to cool');
    await orb.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
    await command("printf '\\a'; printf 'VISIBLE_%s\\n' 'BELL'");
    await until(() => hasOutput(firstId, 'VISIBLE_BELL'), 'foreground bell processed');
    assert.equal(await page.locator('.needs-attention').count(), 0);
    await page.getByRole('tab', { name: 'Terminal 3', exact: true }).click();
    await command('exit');
    await page.waitForSelector('#restart-terminal:not([hidden])');
    await page.getByRole('button', { name: 'Close Terminal 3', exact: true }).click();
    await enableOrb(false);
    await until(
      () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1),
      'disabling the orb destroys its window',
    );
    await application.evaluate(({ Notification, BrowserWindow }) => {
      global.originalNotificationShow = Notification.prototype.show;
      global.testNotifications = [];
      Notification.prototype.show = function () {
        global.testNotifications.push(this);
      };
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'dwell://app/index.html')
        .hide();
    });
    await page.evaluate((id) => window.dwell.bell(id, 'Terminal 1'), firstId);
    await until(
      () => application.evaluate(() => global.testNotifications.length === 1),
      'background alert uses native notification with orb disabled',
    );
    await application.evaluate(({ Notification }) => {
      global.testNotifications[0].emit('click');
      Notification.prototype.show = global.originalNotificationShow;
    });
    await until(
      async () => (await page.locator('.needs-attention').count()) === 0,
      'notification click acknowledges the right terminal',
    );
    await enableOrb(true);
    console.log(
      'PASS: optional desktop orb, real BEL, attention routing and duplicate suppression',
    );

    await page.locator('[data-path="README.md"]').click();
    assert.equal(await page.locator('.markdown h1').textContent(), 'My project');
    await page.locator('#toggle-source').click();
    assert((await page.locator('#preview-content').innerText()).includes('# My project'));
    await page.locator('[data-path="docs"]').click();
    await page.locator('[data-path="docs/unsafe.md"]').click();
    assert.equal(
      await page.locator('.markdown script, .markdown img, .markdown iframe').count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.previewExecuted), undefined);
    assert.equal(await page.locator('.markdown a[href^="javascript:"]').count(), 0);
    console.log('PASS: Markdown rendering and content isolation');
    await page.locator('[data-path="image.png"]').click();
    await page.waitForSelector('.image-preview img');
    assert((await page.locator('.image-preview').innerText()).includes('128 × 128'));
    await page.locator('[data-path="src/new.txt"]').click();
    await fs.unlink(path.join(fixture, 'src/new.txt'));
    await until(
      async () =>
        (await page.locator('#preview-content').innerText()).includes(
          'This file no longer exists.',
        ),
      'deleted preview',
    );
    assert(await page.locator('#toggle-wrap').isHidden());
    console.log('PASS: image previews and file deletion');

    await page.locator('#toggle-hidden').click();
    await page.waitForSelector('[data-path=".hidden"]');
    await page.locator('#toggle-preview').click();
    assert(await page.locator('#preview-pane').isHidden());
    await page.locator('[data-path="src/App.tsx"]').click();
    assert(await page.locator('#preview-pane').isVisible());
    // Give the tree enough room to reach its maximum on the CI Mac's smaller screen.
    await page.locator('#toggle-preview').click();
    for (const [key, bound] of [
      ['ArrowRight', 'aria-valuemax'],
      ['ArrowLeft', 'aria-valuemin'],
    ]) {
      const divider = page.locator('#tree-divider');
      await divider.evaluate((element, key) => {
        for (let i = 0; i < 40; i++)
          element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }, key);
      assert.equal(await divider.getAttribute('aria-valuenow'), await divider.getAttribute(bound));
    }
    await page.locator('#toggle-preview').click();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'dwell://app/index.html')
        .setSize(900, 650),
    );
    await delay(250);
    assert(await page.locator('#tree-pane').isHidden());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('stty size');
    await page.keyboard.press('Enter');
    await until(
      () => page.evaluate(() => /\r\n\d+ \d+\r\n/.test(window.testOutput)),
      'terminal dimensions reach the PTY',
    );
    console.log('PASS: panel size limits, keyboard controls and narrow window');

    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'dwell://app/index.html')
        .setSize(1440, 900),
    );
    await command('clear');
    await page.evaluate((id) => {
      window.testOutput = '';
      window.testOutputs[id] = '';
    }, firstId);
    const program = path.join(root, 'test/fixtures/interactive.cjs').replaceAll("'", "'\\''");
    await command(`node '${program}'`);
    await until(() => hasOutput(firstId, 'Dwell terminal test'), 'interactive terminal screen');
    await menuAction('New Terminal', 'CmdOrCtrl+T');
    await until(
      async () => (await page.getByRole('tab').count()) === 2,
      'New Terminal menu opens another terminal',
    );
    const commandsId = await activeId();
    await command("printf 'COMMANDS_%s\\n' 'BESIDE_PROGRAM'");
    await until(
      () => hasOutput(commandsId, 'COMMANDS_BESIDE_PROGRAM'),
      'shell works while an interactive program is open in another tab',
    );
    await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
    await page.getByRole('tab', { name: 'Terminal 4', exact: true }).click();
    await command('sleep 0.3; exit');
    await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
    await until(
      async () => (await page.locator('.terminal-tab-item.ended').count()) === 1,
      'background terminal exits independently',
    );
    assert(await page.locator('#restart-terminal').isHidden());
    await page.getByRole('tab', { name: 'Terminal 4', exact: true }).click();
    await page.locator('#restart-terminal').click();
    await until(
      async () => (await page.getByRole('tab', { name: 'Terminal 5', exact: true }).count()) === 1,
      'restart creates a fresh session',
    );
    const restartedId = await activeId();
    await command("printf 'RESTART_%s\\n' 'OK'");
    await until(() => hasOutput(restartedId, 'RESTART_OK'), 'restarted shell works');
    await command('exit');
    await page.waitForSelector('#restart-terminal:not([hidden])');
    await menuAction('Close Terminal', 'CmdOrCtrl+W');
    await until(
      async () => (await page.getByRole('tab').count()) === 1,
      'Close Terminal menu closes an ended terminal',
    );
    assert.equal(await activeId(), firstId);
    await page.keyboard.press('Control+c');
    await until(
      () => hasOutput(firstId, 'DWELL_TEST_READY>'),
      'interactive program exits to shell',
    );
    await page.keyboard.type("printf 'DWELL_%s\\n' 'SHELL_RETURNED'");
    await page.keyboard.press('Enter');
    await until(
      () => page.evaluate(() => window.testOutput.includes('DWELL_SHELL_RETURNED')),
      'return from the interactive program',
    );
    console.log('PASS: interactive program exits to the shell');
    assert.deepEqual(errors, []);
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#restart-terminal:not([hidden])');
    console.log('PASS: clean shell exit');
    await page.getByRole('button', { name: 'Close Terminal 1', exact: true }).click();
    await page.waitForSelector('#terminal-empty:not([hidden])');
    await page.locator('[data-path="README.md"]').click();
    await page.locator('[data-path="src/App.tsx"]').click();
    await page.locator('#empty-new-terminal').click();
    await page.waitForSelector('.xterm-helper-textarea');
    const renamedId = await activeId();
    await command('export DWELL_RENAME_TEST=alive');
    await page.getByRole('tab').dblclick();
    await page.getByRole('textbox', { name: 'Terminal name' }).fill('Claude — Dwell');
    await page.getByRole('textbox', { name: 'Terminal name' }).press('Enter');
    assert.equal(await activeId(), renamedId);
    assert(await page.getByRole('button', { name: 'Close Claude — Dwell', exact: true }).count());
    await command('printf \'RENAME_%s\\n\' "$DWELL_RENAME_TEST"');
    await until(() => hasOutput(renamedId, 'RENAME_alive'), 'rename preserves the running shell');
    await page.getByRole('tab', { name: 'Claude — Dwell', exact: true }).dblclick();
    await page.getByRole('textbox', { name: 'Terminal name' }).fill('Cancelled');
    await page.getByRole('textbox', { name: 'Terminal name' }).press('Escape');
    assert.equal(await page.getByRole('tab', { name: 'Claude — Dwell', exact: true }).count(), 1);
    await page.getByRole('tab', { name: 'Claude — Dwell', exact: true }).focus();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'Terminal name' }).fill('  ');
    await page.getByRole('textbox', { name: 'Terminal name' }).press('Enter');
    assert.equal(await page.getByRole('tab', { name: 'Claude — Dwell', exact: true }).count(), 1);
    await command('exit');
    await page.locator('#new-terminal').click();
    await page.getByRole('tab', { selected: true }).dblclick();
    await page.getByRole('textbox', { name: 'Terminal name' }).fill('Git');
    await page.getByRole('textbox', { name: 'Terminal name' }).press('Enter');
    await page.screenshot({ path: path.join(output, 'dwell-renamed-tabs.png') });
    await command('exit');
    await page.waitForSelector('#restart-terminal:not([hidden])');
    assert.deepEqual(errors, []);
    console.log('PASS: background program, session restart and empty terminal state');
    await delay(250);
    await application.close();
    application = null;
    application = await electron.launch({
      executablePath,
      args: executablePath ? [] : [root],
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    await page.waitForSelector('[data-path="src/App.tsx"]');
    assert.equal(await page.locator('#project-name').textContent(), path.basename(fixture));
    assert.equal(await page.locator('#preview-name').textContent(), 'App.tsx');
    assert.equal(await page.locator('#preview-name').getAttribute('title'), 'src/App.tsx');
    assert.equal(await page.locator('#toggle-hidden').getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Claude — Dwell', 'Git']);
    console.log('PASS: renamed tabs and project layout restored after relaunch');
    await until(
      () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 2),
      'orb preference restored after relaunch',
    );
    assert.deepEqual(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.getTitle() === 'Dwell Desktop Orb')
          .getPosition(),
      ),
      orbPosition,
      'orb position survives relaunch',
    );
    await application.evaluate(async ({ Menu }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('desktop-orb');
      if (item.checked) await item.click(item);
    });
    await until(
      () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1),
      'restored orb can be disabled',
    );
    console.log('PASS: desktop orb preference persists');
    await application.evaluate(({ app }) => app.exit(0));
    application = null;
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
      await fs.writeFile(
        path.join(output, 'failure.txt'),
        await page
          .evaluate(() => window.testOutput || document.body.innerText)
          .catch(() => 'Renderer unavailable.'),
      );
    }
    throw error;
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
    await fs.rm(fixture, { recursive: true, force: true });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
