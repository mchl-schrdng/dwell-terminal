const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setClaudeIntegration } = require('../src/claude.cjs');
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
    await fs.mkdtemp(path.join(os.tmpdir(), 'dwell-workspace-app-')),
  );
  const project = path.join(temporary, 'project');
  const profile = path.join(temporary, 'profile');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(profile, 'bin'), { recursive: true });
  await fs.writeFile(
    path.join(project, 'src/App.tsx'),
    'export const first = 1;\nexport const second = 2;\n',
  );
  await fs.writeFile(path.join(project, 'src/café space.js'), 'first\nsecond\nthird\n');
  await fs.writeFile(path.join(project, '.gitignore'), '.claude/\n.env\n');
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Dwell Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'Fixture');
  await fs.writeFile(path.join(project, 'src/App.tsx'), 'staged original\n');
  git('add', '.');
  await fs.appendFile(path.join(project, 'src/App.tsx'), 'unstaged original\n');
  await fs.writeFile(path.join(project, '.env'), 'disposable private value');
  const before = git('diff', '--cached') + git('diff');
  await fs.copyFile(path.join(root, 'test/fixtures/claude.cjs'), path.join(profile, 'bin/claude'));
  await fs.chmod(path.join(profile, 'bin/claude'), 0o700);
  await fs.writeFile(
    path.join(profile, 'bin/maison-fixture'),
    '#!/bin/sh\nexec claude --settings \'{"apiKeyHelper":"fixture-helper"}\' "$@"\n',
    { mode: 0o700 },
  );
  await fs.writeFile(path.join(profile, '.zshenv'), 'unsetopt GLOBAL_RCS\n');
  await fs.writeFile(
    path.join(profile, '.zshrc'),
    'export PATH="$ZDOTDIR/bin:$PATH"\nPROMPT="DWELL_READY> "\nunset HISTFILE\n',
  );
  await fs.writeFile(
    path.join(profile, 'preferences.json'),
    JSON.stringify({
      projects: {},
      claudeLauncher: { command: 'maison-fixture', args: [] },
      desktopOrb: true,
      notificationSound: false,
    }),
  );
  await setClaudeIntegration(path.join(profile, 'claude'), true, true);
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
  const errors = [];
  async function launch() {
    application = await electron.launch({
      executablePath: process.env.DWELL_EXECUTABLE,
      args: [...(process.env.DWELL_EXECUTABLE ? [] : [root]), '--project=' + project],
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('[role=tab]');
    await page.evaluate(() => {
      window.outputs = {};
      window.dwell.onData(({ id, data }) => {
        window.outputs[id] = (window.outputs[id] || '') + data;
      });
    });
  }
  const activeId = () =>
    page
      .getByRole('tab', { selected: true })
      .getAttribute('id')
      .then((id) => id.slice(4));
  const context = (id) => page.evaluate((id) => window.dwell.context(id), id);
  const output = (id, text) =>
    page.evaluate(({ id, text }) => window.outputs[id]?.includes(text), { id, text });
  async function menu(label) {
    await application.evaluate(({ Menu }, label) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((group) => group.submenu?.items || [])
        .find((item) => item.label === label);
      item.click(item);
    }, label);
  }
  async function command(text) {
    const input = page.locator('.terminal-session:not([hidden]) .xterm-helper-textarea');
    await input.focus();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
  async function createTask(name, source) {
    await page.locator('#tab-' + source).click();
    await menu('New Claude Worktree…');
    await page.locator('#worktree-name').fill(name);
    await page.getByRole('button', { name: 'Create Worktree', exact: true }).click();
    await until(async () => (await activeId()) !== source, 'new tab');
    const id = await activeId();
    await until(async () => (await context(id)).conversationId, 'verified Claude identity');
    return { id, ...(await context(id)) };
  }
  try {
    await launch();
    const original = await activeId();
    await page.waitForFunction(() =>
      document.querySelector('.xterm-rows')?.textContent.includes('DWELL_READY>'),
    );
    const a = await createTask('Auth', original);
    const b = await createTask('Auth', original);
    assert.notEqual(a.checkoutRoot, b.checkoutRoot);
    assert.notEqual(a.branch, b.branch);
    assert.notEqual(a.conversationId, b.conversationId);
    assert.equal(before, git('diff', '--cached') + git('diff'));
    assert.equal(
      await fs.readFile(path.join(a.checkoutRoot, 'src/App.tsx'), 'utf8'),
      'export const first = 1;\nexport const second = 2;\n',
    );
    await assert.rejects(fs.stat(path.join(a.checkoutRoot, '.env')));
    await fs.writeFile(path.join(a.checkoutRoot, 'src/App.tsx'), 'Auth first\nAuth second\n');
    await fs.writeFile(path.join(b.checkoutRoot, 'src/App.tsx'), 'Billing first\nBilling second\n');
    for (let i = 0; i < 8; i++) await page.locator('#tab-' + (i % 2 ? b.id : a.id)).click();
    await page.locator('#tab-' + a.id).click();
    await page.locator('[data-path="src"]').click();
    await page.locator('[data-path="src/App.tsx"]').click();
    await until(
      () =>
        page
          .locator('#preview-content')
          .textContent()
          .then((text) => text.includes('Auth second')),
      'Auth files',
    );
    await page.locator('#show-changes').click();
    await until(
      () =>
        page
          .locator('#preview-content')
          .textContent()
          .then((text) => text.includes('+Auth second')),
      'Auth diff',
    );
    await page.locator('#tab-' + b.id).click();
    await page.locator('[data-path="src"]').click();
    await page.locator('[data-path="src/App.tsx"]').click();
    await until(
      () =>
        page
          .locator('#preview-content')
          .textContent()
          .then((text) => text.includes('Billing second')),
      'Billing files',
    );
    await page.locator('#tab-' + a.id).click();
    await until(
      () =>
        page
          .locator('#show-changes')
          .getAttribute('aria-pressed')
          .then((value) => value === 'true'),
      'per-checkout navigation',
    );
    assert((await page.locator('#project-path').getAttribute('title')) === a.checkoutRoot);
    await application.evaluate(
      (_electron, filename) => {
        const files = process.getBuiltinModule('fs/promises');
        const open = files.open;
        files.open = async (...args) => {
          if (args[0] === filename) {
            files.open = open;
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          return open(...args);
        };
      },
      path.join(a.checkoutRoot, 'src/App.tsx'),
    );
    await page.locator('#show-files').click();
    await page.locator('#tab-' + b.id).click();
    await until(
      () =>
        page
          .locator('#preview-content')
          .textContent()
          .then((text) => text.includes('Billing second')),
      'new checkout wins the preview race',
    );
    await delay(550);
    assert(
      !(await page.locator('#preview-content').textContent()).includes('Auth second'),
      'late read cannot paint another checkout',
    );
    await page.locator('#tab-' + a.id).click();
    await page.locator('#show-changes').click();
    await page.locator('#new-terminal').click();
    await until(async () => (await activeId()) !== a.id, 'helper terminal created');
    const helper = await activeId();
    await command('pwd');
    await until(() => output(helper, a.checkoutRoot), 'helper inherits active worktree');
    assert.equal((await context(helper)).conversationId, null);
    console.log(
      'PASS: native PTYs, separate worktrees, dirty HEAD, scoped files/diffs and helper cwd',
    );

    await command('maison-fixture --resume ' + a.conversationId);
    await until(() => output(helper, 'FIXTURE_READY:' + a.conversationId), 'manual Claude');
    await until(async () => (await context(helper)).shared, 'shared checkout recognized');
    await page.locator('#tab-' + a.id).click();
    await until(
      () =>
        page
          .locator('#checkout-status')
          .textContent()
          .then((text) => text.includes('Shared')),
      'shared badge on the other tab',
    );
    await page.evaluate((id) => {
      window.outputs[id] = '';
      window.dwell.input(id, 'QUIT\r');
    }, helper);
    await until(
      () =>
        page
          .locator('#checkout-status')
          .textContent()
          .then((text) => !text.includes('Shared')),
      'shared badge clears when background Claude ends',
    );
    await until(() => output(helper, 'DWELL_READY>'), 'manual Claude returns to its shell');
    await page.locator('#tab-' + helper).click();
    await command('maison-fixture --resume ' + a.conversationId);
    await until(async () => (await context(helper)).shared, 'same conversation restarts manually');
    await command('QUIT');
    console.log('PASS: shared checkout lifecycle and manual resume in an existing shell');

    await page.locator('#tab-' + a.id).click();
    const scope = { id: a.id, revision: (await context(a.id)).revision };
    const escaped = await page.evaluate(
      async ({ scope, path }) => {
        try {
          await window.dwell.preview(scope, path);
          return false;
        } catch {
          return true;
        }
      },
      { scope, path: path.relative(a.checkoutRoot, path.join(b.checkoutRoot, 'src/App.tsx')) },
    );
    assert(escaped, 'another worktree cannot be read through this scope');
    await command('UNRELATED ' + profile);
    await until(() => output(a.id, 'FIXTURE_INPUT:UNRELATED'), 'unrelated metadata processed');
    assert.equal((await context(a.id)).checkoutRoot, a.checkoutRoot);
    await command('REF src/App.tsx:2:3');
    await until(
      () =>
        page
          .locator('.terminal-session:not([hidden]) .xterm-rows')
          .textContent()
          .then((text) => text.includes('src/App.tsx:2:3')),
      'relative reference output',
    );
    // Click the actual rendered reference, including xterm's modifier/link handling.
    const refRow = page
      .locator('.terminal-session:not([hidden]) .xterm-rows > div')
      .filter({ hasText: /^src\/App.tsx:2:3\s*$/ })
      .last();
    const box = await refRow.boundingBox();
    await page.mouse.move(box.x + 35, box.y + 8);
    await page.keyboard.down('Meta');
    await page.mouse.click(box.x + 35, box.y + 8);
    await page.keyboard.up('Meta');
    await until(
      () =>
        page
          .locator('.referenced-line')
          .textContent()
          .then((text) => text.includes('Auth second')),
      'source line opens from diff',
    );
    await command('CWD src');
    await until(async () => (await context(a.id)).cwd.endsWith('/src'), 'cwd changed');
    assert.equal((await context(a.id)).checkoutRoot, a.checkoutRoot);
    const oldReference = await page.evaluate(
      async ({ id, revision, epoch }) =>
        window.dwell.fileLine({ id, revision }, { path: 'src/App.tsx', line: 2, column: 1 }, epoch),
      { id: a.id, revision: (await context(a.id)).revision, epoch: scope.revision },
    );
    assert.equal(oldReference.relative, 'src/App.tsx', 'old output keeps its original cwd');
    await menu('Open File Reference…');
    await page
      .locator('#reference-value')
      .fill('"' + path.join(a.checkoutRoot, 'src/café space.js') + '":2:3');
    await page.getByRole('button', { name: 'Open Preview', exact: true }).click();
    await until(
      () =>
        page
          .locator('.referenced-line')
          .textContent()
          .then((text) => text.includes('second')),
      'quoted Unicode reference',
    );
    console.log(
      'PASS: references open source from diffs, keep old cwd and reject cross-checkout paths',
    );
    await command('FULLSCREEN ' + path.join(a.checkoutRoot, 'src/App.tsx') + ':2');
    const fullscreenRow = page.locator('.terminal-session:not([hidden]) .xterm-rows > div').first();
    await until(
      () => fullscreenRow.textContent().then((text) => text.startsWith('/')),
      'fullscreen reference',
    );
    const fullscreenBox = await fullscreenRow.boundingBox();
    await page.mouse.move(fullscreenBox.x + 35, fullscreenBox.y + 8);
    await page.keyboard.down('Meta');
    await page.mouse.click(fullscreenBox.x + 35, fullscreenBox.y + 8);
    await page.keyboard.up('Meta');
    await until(
      () =>
        page
          .locator('.referenced-line')
          .textContent()
          .then((text) => text.includes('Auth second')),
      'wrapped fullscreen link',
    );
    await command('NORMAL');
    await until(
      () => output(a.id, 'FIXTURE_INPUT:NORMAL'),
      'modified link click did not insert a mouse report into stdin',
    );
    console.log('PASS: wrapped absolute links work with fullscreen mouse reporting');

    const orb = await application
      .waitForEvent('window', { timeout: 1000 })
      .catch(() => application.windows().find((window) => window !== page));
    await command('EVENT PermissionRequest');
    await until(
      () =>
        orb
          .locator('#card-reason')
          .textContent()
          .then((text) => text === 'Approval requested'),
      'approval reason',
    );
    await command('PLAN');
    await until(
      () =>
        orb
          .locator('#card-reason')
          .textContent()
          .then((text) => text === 'Plan to review'),
      'plan refinement',
    );
    await page.evaluate((id) => window.dwell.input(id, 'IDLE\r'), a.id);
    await until(() => output(a.id, 'FIXTURE_INPUT:IDLE'), 'late idle');
    assert.equal(await orb.locator('#card-reason').textContent(), 'Plan to review');
    await orb.locator('#orb').hover();
    await until(() => orb.locator('#orb-card').isVisible(), 'transient card');
    assert((await orb.locator('#orb-card').getAttribute('aria-label')).includes('Plan to review'));
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await orb.screenshot({ path: path.join(root, 'test-results/eclipse-card.png') });
    await orb.locator('#orb-card').click();
    await until(async () => (await activeId()) === a.id, 'card returns to its terminal');
    console.log('PASS: Eclipse reason refinement and accessible click-to-return card');

    await command('QUIT');
    await until(
      () =>
        page
          .locator('#tab-' + a.id)
          .getAttribute('title')
          .then((text) => text.includes('Session ended')),
      'Claude exits',
    );
    assert.equal((await context(a.id)).cwd, null);
    await page.locator('#tab-' + b.id).click();
    await command('QUIT');
    await until(
      () =>
        page
          .locator('#tab-' + b.id)
          .getAttribute('title')
          .then((text) => text.includes('Session ended')),
      'second Claude exits',
    );
    await delay(250);
    await application.evaluate(({ app }) => app.exit(0));
    application = null;
    const prefs = JSON.parse(await fs.readFile(path.join(profile, 'preferences.json')));
    const duplicate = {
      ...prefs.projects[project].tabs.find((tab) => tab.id === a.id),
      id: randomUUID(),
      label: 'Duplicate',
    };
    prefs.projects[project].tabs.push(duplicate);
    await fs.writeFile(path.join(profile, 'preferences.json'), JSON.stringify(prefs));
    await launch();
    await until(
      () =>
        page
          .getByRole('tab')
          .count()
          .then((count) => count === 5),
      'saved tabs',
    );
    assert.equal(
      await page.evaluate(() => Object.keys(window.outputs).length),
      0,
      'restart executes no commands',
    );
    await page.locator('#tab-' + a.id).click();
    await page.getByRole('button', { name: 'Resume Claude', exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, 'test-results/workspace-resume.png') });
    await page.evaluate(() => window.dwell.launcher({ command: 'claude', args: [] }));
    const changedLauncher = await page.evaluate(async (id) => {
      try {
        await window.dwell.start(id, 80, 24, 'resume');
        return false;
      } catch (error) {
        return error.message.includes('launcher has changed');
      }
    }, a.id);
    assert(changedLauncher, 'a changed launcher cannot silently select another account');
    await page.evaluate(() => window.dwell.launcher({ command: 'maison-fixture', args: [] }));
    for (const saved of [a, b]) {
      await page.locator('#tab-' + saved.id).click();
      await page.getByRole('button', { name: 'Resume Claude', exact: true }).click();
      await until(
        () => output(saved.id, 'FIXTURE_READY:' + saved.conversationId),
        'exact conversation resumed',
      );
      assert.equal((await context(saved.id)).checkoutRoot, saved.checkoutRoot);
    }
    console.log(
      'PASS: restart executes nothing; each explicit resume selects its exact conversation',
    );
    await page.locator('#tab-' + duplicate.id).click();
    await page.getByRole('button', { name: 'Resume Claude', exact: true }).click();
    await until(
      async () => (await activeId()) === a.id,
      'duplicate resume focuses the live conversation',
    );
    assert(!(await output(duplicate.id, 'FIXTURE_READY')), 'no duplicate PTY was started');
    await page.locator('#tab-' + b.id).click();
    await command('QUIT');
    await until(
      () =>
        page
          .locator('#tab-' + b.id)
          .getAttribute('title')
          .then((text) => text.includes('Session ended')),
      'resume ends',
    );
    await application.evaluate(({ app }) => app.exit(0));
    application = null;
    await fs.rm(b.checkoutRoot, { recursive: true });
    await launch();
    await page.locator('#tab-' + b.id).click();
    await until(
      () => page.getByRole('button', { name: 'Resume Claude', exact: true }).isDisabled(),
      'deleted worktree is unavailable',
    );
    assert.equal((await context(b.id)).conversationId, b.conversationId);
    await page.getByRole('button', { name: 'Open Terminal in Project', exact: true }).click();
    await command('pwd');
    await until(() => output(b.id, project), 'explicit terminal recovery');
    assert.equal((await context(b.id)).conversationId, null);
    assert.deepEqual(errors, []);
    console.log('PASS: deleted worktree blocks resume and offers explicit plain-terminal recovery');
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/workspaces.png') });
  } catch (error) {
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: path.join(root, 'test-results/workspaces-failure.png') })
        .catch(() => {});
      await fs.writeFile(
        path.join(root, 'test-results/workspaces-failure.txt'),
        await page
          .locator('body')
          .innerText()
          .catch(() => 'unavailable'),
      );
    }
    throw error;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
