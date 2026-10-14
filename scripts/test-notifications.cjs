const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { quotePaths } = require('../src/files.cjs');
const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out: ' + label);
}

(async () => {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-native-status-')),
  );
  const project = path.join(temporary, 'project');
  const otherProject = path.join(temporary, 'other');
  const profile = path.join(temporary, 'profile');
  for (const directory of [project, otherProject, profile]) await fs.mkdir(directory);
  await fs.writeFile(path.join(otherProject, 'private.txt'), 'Outside scope');
  await fs.writeFile(path.join(profile, '.zshenv'), 'unsetopt GLOBAL_RCS\n');
  await fs.writeFile(
    path.join(profile, '.zshrc'),
    'PROMPT="STATUS_SHELL_READY> "\nunset HISTFILE\n',
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
  let orb;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: process.env.DWELL_EXECUTABLE,
      args: [...(process.env.DWELL_EXECUTABLE ? [] : [root]), '--project=' + project],
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('[role=tab]');
    await page.waitForFunction(() =>
      document.querySelector('.xterm-rows')?.textContent.includes('STATUS_SHELL_READY>'),
    );
    await until(() => {
      orb = application.windows().find((window) => window.url().endsWith('/orb.html'));
      return Boolean(orb);
    }, 'a fresh profile enables the orb');
    await orb.waitForSelector('#orb');
    await orb.emulateMedia({ reducedMotion: 'reduce' });
    orb.on('pageerror', (error) => errors.push(error.message));
    await application.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      const main = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith('/index.html'),
      );
      main.focus();
      // The user's other apps may take OS focus while this isolated policy test runs.
      global.nativeStatusOriginalFocus = BrowserWindow.prototype.isFocused;
      global.nativeStatusMainWindow = main.id;
      global.nativeStatusFocusedWindow = main.id;
      BrowserWindow.prototype.isFocused = function () {
        return this.id === global.nativeStatusFocusedWindow;
      };
      const childProcess = process.getBuiltinModule('child_process');
      global.nativeStatusExecFile = childProcess.execFile;
      global.nativeStatusSounds = [];
      childProcess.execFile = function (file, ...args) {
        if (file !== '/usr/bin/afplay')
          return global.nativeStatusExecFile.call(this, file, ...args);
        global.nativeStatusSounds.push({
          args: args[0],
          focused: BrowserWindow.getFocusedWindow()?.getTitle(),
        });
        args.at(-1)(null);
        return {};
      };
    });
    await page.waitForFunction(() => document.hasFocus());
    await page.evaluate(() => {
      window.statusOutput = {};
      window.statusAttention = {};
      window.dwell.onData(({ id, data }) => {
        window.statusOutput[id] = (window.statusOutput[id] || '') + data;
      });
      window.dwell.onAttention((event) => {
        window.statusAttention[event.id] = event;
      });
    });
    const activeId = () =>
      page
        .getByRole('tab', { selected: true })
        .getAttribute('id')
        .then((id) => id.slice(4));
    const output = (id, text) =>
      page.evaluate(({ id, text }) => window.statusOutput[id]?.includes(text), { id, text });
    const input = (id, text) =>
      page.evaluate(({ id, text }) => window.dwell.input(id, text + '\r'), { id, text });
    const sounds = () => application.evaluate(() => global.nativeStatusSounds.length);
    const orbStatus = (status) =>
      until(
        () =>
          orb
            .locator('#orb')
            .getAttribute('data-status')
            .then((value) => value === status),
        'orb status ' + status,
      );
    const attention = (id) => page.evaluate((id) => window.statusAttention[id], id);
    const context = (id) => page.evaluate((id) => window.dwell.context(id), id);
    async function report(id, command, status) {
      await page.evaluate((id) => {
        window.statusOutput[id] = '';
      }, id);
      await input(id, command);
      await until(() => output(id, 'STATUS_SENT:' + command), 'native report ' + command);
      if (status) await orbStatus(status);
    }
    async function mute(value) {
      await application.evaluate(({ Menu }, value) => {
        const item = Menu.getApplicationMenu().getMenuItemById('notification-sound');
        if (item.checked === value) item.click(item);
      }, value);
    }
    async function focusProject() {
      await application.evaluate(({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(
          (item) => item.id === global.nativeStatusMainWindow,
        );
        window.show();
        app.focus({ steal: true });
        window.focus();
        global.nativeStatusFocusedWindow = window.id;
      });
    }
    const first = await activeId();
    assert.equal(
      await application.evaluate(
        ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('claude-integration').checked,
      ),
      false,
    );
    await assert.rejects(fs.stat(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')), {
      code: 'ENOENT',
    });
    await input(
      first,
      quotePaths([process.execPath, path.join(root, 'test/fixtures/program-status.cjs')]),
    );
    await until(
      () => output(first, 'STATUS_HANDSHAKE_BEFORE_DA'),
      'native support reply precedes device attributes',
    );
    for (const [command, status] of [
      ['working', 'working'],
      ['permission', 'attention'],
      ['question', 'attention'],
      ['auth', 'attention'],
      ['done', 'attention'],
      ['error', 'error'],
      ['idle', 'idle'],
      ['clear', 'idle'],
    ]) {
      await focusProject();
      await report(first, command, status);
    }
    assert.equal(
      await sounds(),
      0,
      'foreground state changes remain silent: ' +
        JSON.stringify(await application.evaluate(() => global.nativeStatusSounds)),
    );
    console.log(
      'PASS: fresh installation negotiates native status before DA and receives every state without Claude configuration',
    );

    await report(first, 'working', 'working');
    await application.evaluate(() => {
      const { ChildProcess } = process.getBuiltinModule('child_process');
      global.nativeStatusSpawn = ChildProcess.prototype.spawn;
      global.nativeStatusPs = { running: 0, total: 0, maximum: 0 };
      // Observe real children even when a module captured execFile before this test.
      ChildProcess.prototype.spawn = function (options) {
        const result = global.nativeStatusSpawn.call(this, options);
        if (options.file === '/bin/ps' || options.file === '/usr/sbin/lsof') {
          const metrics = global.nativeStatusPs;
          metrics.total++;
          metrics.maximum = Math.max(metrics.maximum, ++metrics.running);
          this.once('close', () => metrics.running--);
        }
        return result;
      };
    });
    try {
      const before = await sounds();
      await report(first, 'bell-burst');
      await page.waitForFunction(() =>
        document.querySelector('.xterm-rows')?.textContent.includes('STATUS_SENT:bell-burst'),
      );
      await until(
        () =>
          application.evaluate(
            () => global.nativeStatusPs.total > 0 && global.nativeStatusPs.running === 0,
          ),
        'native shell checks finish after the bell burst',
      );
      const metrics = await application.evaluate(() => global.nativeStatusPs);
      assert(
        metrics.maximum <= 3,
        'bell bursts bound simultaneous OS checks: ' + JSON.stringify(metrics),
      );
      assert.equal(await orb.locator('#orb').getAttribute('data-status'), 'working');
      assert.equal(await sounds(), before, 'bells cannot replay a native program alert');
      await application.evaluate(() => {
        global.nativeStatusPs = { running: 0, total: 0, maximum: 0 };
      });
      await report(first, 'native-burst', 'working');
      await until(
        () =>
          application.evaluate(
            () => global.nativeStatusPs.total > 0 && global.nativeStatusPs.running === 0,
          ),
        'native identity checks finish after the status burst',
      );
      const nativeMetrics = await application.evaluate(() => global.nativeStatusPs);
      assert(
        nativeMetrics.maximum <= 2,
        'native report bursts bound simultaneous OS checks: ' + JSON.stringify(nativeMetrics),
      );
    } finally {
      await application.evaluate(() => {
        process.getBuiltinModule('child_process').ChildProcess.prototype.spawn =
          global.nativeStatusSpawn;
      });
    }
    console.log('PASS: bursts of 100 bells and native reports bound OS process checks');

    for (const command of ['legacy-idle', 'legacy-error', 'invalid', 'oversize']) {
      await report(first, command);
      await delay(100);
      assert.equal(await orb.locator('#orb').getAttribute('data-status'), 'working');
    }
    await report(first, 'forged ' + otherProject, 'working');
    assert.equal((await context(first)).checkoutRoot, project);
    assert.equal((await context(first)).conversationId, null);
    const escaped = await page.evaluate(
      async ({ id, filename }) => {
        const { revision } = await window.dwell.context(id);
        try {
          await window.dwell.preview({ id, revision }, filename);
          return false;
        } catch {
          return true;
        }
      },
      { id: first, filename: path.relative(project, path.join(otherProject, 'private.txt')) },
    );
    assert(escaped, 'native status has no authority to widen the file scope');
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await orb.screenshot({ path: path.join(root, 'test-results/native-orb-working.png') });
    console.log(
      'PASS: malformed status and legacy progress cannot replace native state or change project scope',
    );

    await page.locator('#new-terminal').click();
    await until(async () => (await activeId()) !== first, 'second terminal opens');
    const second = await activeId();
    await report(first, 'permission', 'attention');
    await until(async () => (await sounds()) === 1, 'background attention dispatches its chime');
    assert.equal((await attention(first)).pending, true);
    assert.equal(await orb.locator('#card-reason').textContent(), 'Approval requested');
    await orb.screenshot({ path: path.join(root, 'test-results/native-orb-attention.png') });
    await delay(1600);
    await report(first, 'permission', 'attention');
    await report(first, 'question', 'attention');
    assert.equal(await sounds(), 1, 'duplicate reports and reason refinements do not replay sound');
    await mute(true);
    await report(first, 'working', 'working');
    await report(first, 'error', 'error');
    assert.equal(await sounds(), 1, 'the sound preference mutes native alerts');
    await mute(false);
    await report(first, 'working', 'working');
    await report(first, 'done', 'attention');
    await until(async () => (await sounds()) === 2, 'reenabling sound restores the next alert');
    await orb.locator('#orb').click();
    await until(async () => (await activeId()) === first, 'the orb returns to its originating tab');
    await until(
      async () => (await attention(first)).pending === false,
      'opening the tab acknowledges its alert',
    );
    assert.equal(await page.getByRole('tab').count(), 2);
    console.log(
      'PASS: background alerts, mute, deduplication and return-to-tab work with native status',
    );

    await mute(true);
    await report(first, 'working', 'working');
    await application.evaluate(({ dialog }, folder) => {
      global.nativeStatusOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, otherProject);
    try {
      const opened = application.waitForEvent('window', {
        predicate: (window) => window.url().endsWith('/index.html'),
      });
      await application.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()
          .items.flatMap((group) => group.submenu?.items || [])
          .find((item) => item.label === 'Open Folder in New Window…');
        return item.click(
          item,
          BrowserWindow.getAllWindows().find(
            (window) => window.webContents.getURL() === 'dwell://app/index.html',
          ),
        );
      });
      await opened;
    } finally {
      await application.evaluate(({ dialog }) => {
        dialog.showOpenDialog = global.nativeStatusOpenDialog;
      });
    }
    const otherPage = application
      .windows()
      .find((window) => window !== page && window.url().endsWith('/index.html'));
    assert(otherPage, 'another project opens a distinct test window');
    otherPage.on('pageerror', (error) => errors.push(error.message));
    await otherPage.waitForSelector('[role=tab]');
    const otherWindow = await application.browserWindow(otherPage);
    await otherWindow.evaluate((window) => {
      global.nativeStatusFocusedWindow = window.id;
    });
    await otherPage.bringToFront();
    await otherPage.waitForFunction(() => document.hasFocus());
    await report(first, 'permission', 'attention');
    assert.equal((await attention(first)).pending, true);
    await orb.locator('#orb').click();
    await page.waitForFunction(() => document.hasFocus());
    await focusProject();
    assert.equal(await activeId(), first);
    assert.equal(await otherPage.locator('.needs-attention').count(), 0);
    console.log('PASS: native alerts route back to their own project window');

    await report(first, 'working', 'working');
    await report(first, 'reset', 'idle');
    await report(first, 'legacy-error', 'error');
    await report(first, 'working', 'working');
    await page.locator('#tab-' + second).click();
    await input(first, 'quit');
    await until(
      () => output(first, 'STATUS_SHELL_READY>'),
      'the native reporter exits to its original shell',
    );
    await orbStatus('idle');
    await mute(true);
    await input(first, "printf '\\a'");
    await orbStatus('attention');
    assert.equal(
      (await attention(first)).pending,
      true,
      'ordinary background bells work again after the native program exits',
    );
    await page.locator('#new-terminal').click();
    await until(
      async () => ![first, second].includes(await activeId()),
      'dedicated status terminal opens',
    );
    let dedicated = await activeId();
    for (const result of ['done', 'error']) {
      await page.locator('#tab-' + dedicated).click();
      await page.evaluate((id) => {
        window.statusOutput[id] = '';
      }, dedicated);
      await input(
        dedicated,
        'exec ' +
          quotePaths([process.execPath, path.join(root, 'test/fixtures/program-status.cjs')]),
      );
      await until(
        () => output(dedicated, 'STATUS_HANDSHAKE_BEFORE_DA'),
        'the dedicated process negotiates status',
      );
      await report(dedicated, 'working');
      await page.locator('#tab-' + second).click();
      await input(dedicated, 'fast-' + result);
      await until(
        () =>
          page
            .locator('#tab-' + dedicated)
            .locator('..')
            .getAttribute('class')
            .then((value) => value.includes('ended')),
        'the dedicated PTY process exits',
      );
      await until(
        async () => {
          const state = await attention(dedicated);
          return state?.pending && state.status === (result === 'done' ? 'attention' : 'error');
        },
        'the final native ' + result + ' report survives immediate PTY exit',
      );
      if (result === 'done') {
        await page.locator('#tab-' + dedicated).click();
        await until(
          async () => (await attention(dedicated)).pending === false,
          'viewing an ended terminal acknowledges its result',
        );
        await page.evaluate((id) => {
          window.statusOutput[id] = '';
        }, dedicated);
        await page.locator('#restart-terminal').click();
        await until(
          async () => ![first, second, dedicated].includes(await activeId()),
          'restart replaces the ended terminal',
        );
        dedicated = await activeId();
        await until(
          () => output(dedicated, 'STATUS_SHELL_READY>'),
          'the terminal can restart after native completion',
        );
        await until(
          async () => ((await attention(dedicated))?.status || 'idle') === 'idle',
          'restart does not inherit the prior native result',
        );
      }
    }
    console.log(
      'PASS: immediate PTY completion retains final done/error reports and restarting clears them',
    );
    await assert.rejects(fs.stat(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')), {
      code: 'ENOENT',
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: terminal reset and process exit release native state without modifying Claude settings',
    );
  } catch (error) {
    if (application)
      console.error(
        await application
          .evaluate(({ app, BrowserWindow }) => ({
            hidden: app.isHidden(),
            dock: app.dock.isVisible(),
            windows: BrowserWindow.getAllWindows().map((window) => ({
              title: window.getTitle(),
              visible: window.isVisible(),
              focused: window.isFocused(),
              minimized: window.isMinimized(),
            })),
          }))
          .catch(() => null),
      );
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(root, 'test-results/native-status-failure.png') })
        .catch(() => {});
    throw error;
  } finally {
    if (application)
      await application
        .evaluate(({ app, BrowserWindow }) => {
          if (global.nativeStatusOriginalFocus)
            BrowserWindow.prototype.isFocused = global.nativeStatusOriginalFocus;
          app.exit(0);
        })
        .catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
