const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  shell,
  clipboard,
  nativeImage,
  nativeTheme,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const pty = require('node-pty');
const { resolveFile, listFiles, readPreview, friendlyError, quotePaths } = require('./files.cjs');
const { git, listChanges, readDiff } = require('./git.cjs');
const { createAttention } = require('./attention.cjs');
const {
  setClaudeIntegration,
  isClaudeIntegrationEnabled,
  launcher,
  launchCommand,
  checkLauncher,
  parseClaudeMessage,
} = require('./claude.cjs');
const {
  UUID,
  checkout,
  verifyCheckout,
  observeDirectory,
  newWorktree,
  restoreTabs,
} = require('./workspaces.cjs');
const claudeConfig = path.resolve(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
);

app.setName('Dwell');
nativeTheme.themeSource = 'dark';
if (process.env.DWELL_USER_DATA) app.setPath('userData', process.env.DWELL_USER_DATA);
protocol.registerSchemesAsPrivileged([
  { scheme: 'dwell', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const windows = new Map();
const reservedWorktrees = new Set();
let preferences = { projects: {} };
const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
try {
  preferences = { projects: {}, ...JSON.parse(fs.readFileSync(preferencesPath, 'utf8')) };
} catch {}
const attention = createAttention(windows, preferences, savePreferences);
const launcherKey = (definition = preferences.claudeLauncher) =>
  createHash('sha256')
    .update(JSON.stringify(launcher(definition)))
    .digest('hex');

function savePreferences() {
  try {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    fs.writeFileSync(preferencesPath + '.tmp', JSON.stringify(preferences));
    fs.renameSync(preferencesPath + '.tmp', preferencesPath);
  } catch (error) {
    console.error('Could not save window preferences:', error.message);
  }
}

function send(state, channel, value) {
  if (!state.window.isDestroyed()) state.window.webContents.send(channel, value);
}

function stopTerminals(state) {
  attention.clear(state);
  for (const session of state.sessions.values()) {
    try {
      session.process?.kill();
    } catch {}
  }
  state.sessions.clear();
  refreshSharedContexts();
}

async function chooseFolder(parent) {
  const result = await dialog.showOpenDialog(parent, {
    title: 'Open Folder',
    buttonLabel: 'Open Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled) return;
  const root = await fsp.realpath(result.filePaths[0]);
  const current = parent && windows.get(parent.webContents.id);
  if (current && !current.root) {
    current.root = root;
    preferences.lastRoot = root;
    savePreferences();
    parent.setTitle(path.basename(root) + ' — Dwell');
    send(current, 'project:opened', getProject(current));
  } else await createWindow(root);
}

function getProject(state) {
  if (state.root && !state.restored) {
    state.restored = true;
    for (const tab of restoreTabs(preferences.projects[state.root] || {}, state.root))
      state.sessions.set(tab.id, {
        ...tab,
        revision: 0,
        cwd: null,
        status: 'saved',
        closedConversations: new Set(),
      });
  }
  return {
    root: state.root,
    name: state.root ? path.basename(state.root) : 'Dwell',
    home: os.homedir(),
    settings: preferences.projects[state.root] || {},
    tabs: [...state.sessions.values()].map((session) => publicContext(state, session)),
    launcher: launcher(preferences.claudeLauncher),
  };
}

async function createWindow(root) {
  if (root) {
    try {
      root = await fsp.realpath(root);
      if (!(await fsp.stat(root)).isDirectory()) root = null;
    } catch {
      root = null;
    }
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 780,
    minHeight: 500,
    title: root ? path.basename(root) + ' — Dwell' : 'Dwell',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  const state = {
    window,
    root,
    sessions: new Map(),
    watchers: new Map(),
    watchVersion: 0,
    closing: false,
  };
  const windowId = window.webContents.id;
  windows.set(windowId, state);
  if (root) {
    preferences.lastRoot = root;
    savePreferences();
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('ready-to-show', () => window.show());
  window.on('close', (event) => {
    const count = [...state.sessions.values()].filter((session) => session.process).length;
    if (!count || state.closing) return;
    event.preventDefault();
    if (state.confirming) return;
    state.confirming = true;
    dialog
      .showMessageBox(window, {
        type: 'question',
        message: count === 1 ? 'Close this terminal session?' : `Close ${count} terminal sessions?`,
        detail: 'All shells and running programs in this window will stop.',
        buttons: ['Keep Open', 'Close Window'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        state.confirming = false;
        if (response === 1) {
          state.closing = true;
          window.close();
        }
      });
  });
  window.on('closed', () => {
    clearTimeout(state.watchTimer);
    for (const watcher of state.watchers.values()) watcher.close();
    stopTerminals(state);
    windows.delete(windowId);
    if (!windows.size) attention.destroyOrb();
  });
  // A crashed renderer must not leave an invisible terminal process running.
  window.webContents.on('render-process-gone', () => stopTerminals(state));
  await window.loadURL('dwell://app/index.html');
  return window;
}

function validState(event) {
  const state = windows.get(event.sender.id);
  if (
    !state ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== 'dwell://app/index.html'
  )
    throw new Error('Invalid application context.');
  return state;
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await callback(validState(event), ...args) };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  });
}

function publicContext(state, session) {
  return {
    id: session.id,
    label: session.label,
    checkoutRoot: session.checkoutRoot,
    conversationId: session.conversationId || null,
    launcher: session.launcher || null,
    revision: session.revision,
    cwd: session.cwd,
    branch: session.branch || '',
    status: session.status,
    error: session.contextError || null,
    shared: Boolean(
      session.claudeLive &&
      [...windows.values()].some((owner) =>
        [...owner.sessions.values()].some(
          (other) =>
            other !== session && other.claudeLive && other.checkoutRoot === session.checkoutRoot,
        ),
      ),
    ),
  };
}

function persistTabs(state) {
  if (!state.root) return;
  const settings = (preferences.projects[state.root] ||= {});
  settings.tabs = [...state.sessions.values()].map((session) => ({
    id: session.id,
    label: session.label,
    checkoutRoot: session.checkoutRoot,
    conversationId: session.conversationId || null,
    launcher: session.launcher || null,
  }));
  delete settings.terminalNames;
  savePreferences();
}

function detachWatchers(state) {
  state.watchVersion++;
  clearTimeout(state.watchTimer);
  state.watchTimer = null;
  for (const watcher of state.watchers.values()) watcher.close();
  state.watchers.clear();
}

function contextChanged(state, session) {
  session.revision++;
  (session.epochs ||= new Map()).set(session.revision, {
    root: session.checkoutRoot,
    cwd: session.cwd,
  });
  if (session.epochs.size > 128) session.epochs.delete(session.epochs.keys().next().value);
  if (state.activeSession === session.id) detachWatchers(state);
  refreshSharedContexts();
  persistTabs(state);
}

function refreshSharedContexts() {
  for (const owner of windows.values())
    for (const session of owner.sessions.values())
      send(owner, 'terminal:context', publicContext(owner, session));
}

async function contextRoot(state, scope) {
  const session = state.sessions.get(scope?.id);
  if (!session || scope.revision !== session.revision)
    throw new Error('The terminal context changed. Try again.');
  if (['starting', 'unavailable'].includes(session.status))
    throw new Error(
      session.status === 'starting'
        ? 'Waiting for Claude to confirm its worktree.'
        : 'This checkout is unavailable. Open a terminal in the project to recover.',
    );
  const root = await fsp.realpath(session.checkoutRoot);
  if (root !== session.checkoutRoot || scope.revision !== session.revision)
    throw new Error('The checkout changed. Reopen its folder.');
  return root;
}

function scoped(channel, callback) {
  handle(channel, async (state, scope, ...args) =>
    callback(await contextRoot(state, scope), ...args),
  );
}

handle('project:get', (state) => getProject(state));
handle('project:choose', (state) => chooseFolder(state.window));
handle('terminal:menu', (state) =>
  Menu.buildFromTemplate([
    { label: 'New Terminal', click: () => send(state, 'menu:action', 'new-terminal') },
    { label: 'New Claude Worktree…', click: () => send(state, 'menu:action', 'new-worktree') },
  ]).popup({ window: state.window }),
);
scoped('git:changes', (root) => listChanges(root));
scoped('git:diff', (root, relative) => readDiff(root, relative));
scoped('files:reference', async (root, relative) => {
  return quotePaths([await resolveFile(root, relative)]);
});
handle('files:line', async (state, scope, reference, epoch) => {
  const root = await contextRoot(state, scope);
  const session = state.sessions.get(scope.id);
  if (
    !reference ||
    typeof reference.path !== 'string' ||
    reference.path.length > 4096 ||
    !Number.isInteger(reference.line) ||
    reference.line < 1 ||
    reference.line > 9999999 ||
    !Number.isInteger(reference.column) ||
    reference.column < 1 ||
    reference.column > 9999999
  )
    throw new Error('Invalid file reference.');
  const base = session.epochs?.get(epoch);
  if (!path.isAbsolute(reference.path) && (!base?.cwd || base.root !== root))
    throw new Error('The directory for that output is unknown. Use an absolute file path.');
  const filename = path.isAbsolute(reference.path)
    ? reference.path
    : path.resolve(base.cwd, reference.path);
  const relative = path.relative(root, filename);
  const actual = await resolveFile(root, relative);
  if (!(await fsp.stat(actual)).isFile()) throw new Error('This reference is not a regular file.');
  if (scope.revision !== session.revision)
    throw new Error('The terminal context changed. Try again.');
  return { relative: path.relative(root, actual), line: reference.line, column: reference.column };
});
scoped('files:quote', (_root, paths) => quotePaths(paths));
scoped('files:list', (root, relative, hidden) => {
  return listFiles(root, relative, hidden === true);
});
scoped('files:preview', async (root, relative) => {
  const preview = await readPreview(root, relative);
  if (preview.kind === 'image') {
    const image = nativeImage.createFromBuffer(preview.bytes);
    if (image.isEmpty())
      return {
        kind: 'unsupported',
        size: preview.size,
        reason: 'This image could not be decoded.',
      };
    const dimensions = image.getSize();
    const scale = Math.min(1, 1800 / Math.max(dimensions.width, dimensions.height));
    const thumbnail =
      scale < 1 ? image.resize({ width: Math.round(dimensions.width * scale) }) : image;
    return { kind: 'image', size: preview.size, ...dimensions, data: thumbnail.toDataURL() };
  }
  return preview;
});
scoped('files:open', async (root, relative) => {
  const filename = await resolveFile(root, relative);
  // Opening executable files is never a preview action.
  const stat = await fsp.stat(filename);
  if (
    !stat.isFile() ||
    stat.mode & 0o111 ||
    /\.(app|command|sh|zsh|bash|scpt|workflow|webloc)$/i.test(filename)
  )
    throw new Error('Open executable files manually in Finder.');
  const error = await shell.openPath(filename);
  if (error) throw new Error(error);
});
scoped('files:reveal', async (root, relative) =>
  shell.showItemInFolder(await resolveFile(root, relative)),
);
handle('files:watch', async (state, scope, directories) => {
  const root = await contextRoot(state, scope);
  if (state.activeSession !== scope.id || !Array.isArray(directories)) return;
  const version = ++state.watchVersion;
  const wanted = new Set(directories.filter((value) => typeof value === 'string').slice(0, 256));
  wanted.add('.');
  for (const [relative, watcher] of state.watchers)
    if (!wanted.has(relative)) {
      watcher.close();
      state.watchers.delete(relative);
    }
  for (const relative of wanted) {
    try {
      const directory = await resolveFile(root, relative);
      const stat = await fsp.stat(directory);
      if (version !== state.watchVersion || state.window.isDestroyed()) return;
      const existing = state.watchers.get(relative);
      if (existing?.dwellInode === stat.ino) continue;
      existing?.close();
      const watcher = fs.watch(directory, () => {
        if (!state.watchTimer)
          state.watchTimer = setTimeout(() => {
            state.watchTimer = null;
            if (
              state.activeSession === scope.id &&
              state.sessions.get(scope.id)?.revision === scope.revision
            )
              send(state, 'files:changed', scope);
          }, 140);
      });
      watcher.dwellInode = stat.ino;
      watcher.on('error', () => {
        watcher.close();
        state.watchers.delete(relative);
      });
      state.watchers.set(relative, watcher);
    } catch {
      if (version !== state.watchVersion) return;
      state.watchers.get(relative)?.close();
      state.watchers.delete(relative);
    }
  }
});
handle('settings:save', (state, value) => {
  if (!state.root || !value || typeof value !== 'object') return;
  const settings = {
    treeWidth: Math.max(180, Math.min(550, Number(value.treeWidth) || 260)),
    previewWidth: Math.max(300, Math.min(900, Number(value.previewWidth) || 450)),
    showTree: value.showTree !== false,
    showPreview: value.showPreview !== false,
    hidden: value.hidden === true,
    wrap: value.wrap !== false,
    treeMode: value.treeMode === 'changes' ? 'changes' : 'files',
    expanded: Array.isArray(value.expanded)
      ? value.expanded.filter((p) => typeof p === 'string').slice(0, 256)
      : [],
    selected: typeof value.selected === 'string' ? value.selected : null,
  };
  for (const tab of Array.isArray(value.tabs) ? value.tabs.slice(0, 32) : []) {
    const session = state.sessions.get(tab?.id);
    if (session && typeof tab.label === 'string')
      session.label = tab.label.trim().slice(0, 80) || 'Terminal';
  }
  preferences.projects[state.root] = { ...preferences.projects[state.root], ...settings };
  persistTabs(state);
});

function terminalSize(cols, rows) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= 2 &&
    cols <= 1000 &&
    rows >= 1 &&
    rows <= 500
  );
}
handle('terminal:create', async (state, id, label, parentId) => {
  if (!state.root) throw new Error('Open a folder first.');
  if (typeof id !== 'string' || !UUID.test(id) || state.sessions.has(id))
    throw new Error('Invalid terminal session.');
  if (state.sessions.size >= 32) throw new Error('Up to 32 terminals can be open in one window.');
  const parent = state.sessions.get(parentId);
  const root = parent
    ? await contextRoot(state, { id: parent.id, revision: parent.revision })
    : state.root;
  if (state.sessions.has(id) || state.sessions.size >= 32)
    throw new Error('Invalid terminal session.');
  const session = {
    id,
    label: typeof label === 'string' ? label.trim().slice(0, 80) : 'Terminal',
    checkoutRoot: root,
    cwd: null,
    revision: 0,
    status: 'ready',
    closedConversations: new Set(),
  };
  state.sessions.set(id, session);
  const info = await checkout(root).catch(() => null);
  session.branch = info?.branch;
  persistTabs(state);
  return publicContext(state, session);
});

handle('terminal:context', async (state, id) => {
  const session = state.sessions.get(id);
  if (!session) throw new Error('Invalid terminal session.');
  if (session.status === 'starting') return publicContext(state, session);
  if (session.unconfirmed) return publicContext(state, session);
  const revision = session.revision;
  try {
    const actual = await fsp.realpath(session.checkoutRoot);
    if (actual !== session.checkoutRoot) throw new Error('Checkout changed.');
    const info =
      session.checkoutRoot === state.root
        ? await checkout(actual).catch(() => null)
        : await verifyCheckout(state.root, actual);
    const status = 'ready';
    if (session.revision !== revision || state.sessions.get(id) !== session)
      return publicContext(state, session);
    if (session.status !== status || session.branch !== info?.branch) {
      session.status = status;
      session.branch = info?.branch;
      contextChanged(state, session);
    }
  } catch {
    if (session.revision !== revision || state.sessions.get(id) !== session)
      return publicContext(state, session);
    if (session.status !== 'unavailable') {
      session.status = 'unavailable';
      session.cwd = null;
      contextChanged(state, session);
    }
  }
  return publicContext(state, session);
});

handle('claude:launcher', (_state, value) => {
  preferences.claudeLauncher = launcher(value);
  savePreferences();
  return preferences.claudeLauncher;
});

function terminalEnvironment() {
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Dwell',
    TERM_PROGRAM_VERSION: app.getVersion(),
    DWELL_CLAUDE_HOOK: path.join(
      app.isPackaged ? process.resourcesPath : __dirname,
      'claude-hook.sh',
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  env.PATH = [
    path.join(os.homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    env.PATH,
  ]
    .filter(Boolean)
    .join(':');
  return env;
}

handle('terminal:start', async (state, id, cols, rows, mode = 'shell', task) => {
  const session = state.sessions.get(id);
  if (!session || session.process || session.launching)
    throw new Error('Invalid terminal session.');
  if (!terminalSize(cols, rows) || !['shell', 'worktree', 'resume', 'recover'].includes(mode))
    throw new Error('Invalid terminal launch.');
  if (mode === 'resume' && !UUID.test(session.conversationId))
    throw new Error('No saved Claude conversation in this tab.');
  if (mode === 'resume' && session.launcher !== launcherKey())
    throw new Error(
      'The Claude launcher has changed since this conversation was saved. Restore its original launcher before resuming.',
    );
  if (mode === 'resume') {
    for (const owner of windows.values())
      for (const other of owner.sessions.values()) {
        if (
          other !== session &&
          (other.process || other.launching) &&
          other.conversationId === session.conversationId
        ) {
          owner.window.show();
          owner.window.focus();
          send(owner, 'terminal:focus', other.id);
          return { existing: true };
        }
      }
  }
  session.launching = true;
  try {
    const env = terminalEnvironment();
    const loginShell = process.env.SHELL || '/bin/zsh';
    let command = { file: loginShell, args: ['-l'] };
    const cwd =
      mode === 'recover'
        ? state.root
        : await contextRoot(state, { id, revision: session.revision });
    if (mode === 'worktree') {
      session.status = 'starting';
      session.unconfirmed = true;
      contextChanged(state, session);
    }
    if (mode === 'worktree' || mode === 'resume') {
      const definition = launcher(preferences.claudeLauncher);
      env.DWELL_CLAUDE_BINARY = await checkLauncher(loginShell, definition, env, cwd);
      if (!(await isClaudeIntegrationEnabled(claudeConfig)))
        throw new Error(
          'Enable Help → Claude Code Integration before starting a Claude workspace.',
        );
      await setClaudeIntegration(claudeConfig, true, true);
      session.launcher = launcherKey(definition);
      if (mode === 'worktree') {
        session.worktree = await newWorktree(state.root, cwd, task, reservedWorktrees);
        env.DWELL_LAUNCH_BIN = path.join(
          app.isPackaged ? process.resourcesPath : __dirname,
          'claude-bin',
        );
        // Absolute stock CLI paths must also pass through the settings-preserving adapter.
        const target =
          path.basename(definition.command) === 'claude'
            ? { ...definition, command: path.join(env.DWELL_LAUNCH_BIN, 'claude') }
            : definition;
        command = launchCommand(loginShell, target, ['--worktree', session.worktree.name], true);
        session.status = 'starting';
      } else {
        await observeDirectory(state.root, cwd);
        command = launchCommand(loginShell, definition, ['--resume', session.conversationId]);
      }
    } else {
      session.unconfirmed = false;
      session.worktree = null;
      session.checkoutRoot = cwd;
      session.conversationId = null;
      session.launcher = null;
      session.status = 'ready';
    }
    session.cwd = null;
    session.kind = mode;
    session.expectedConversation = mode === 'resume' ? session.conversationId : null;
    session.nonce = randomUUID();
    session.closedConversations.clear();
    session.claudeLive = false;
    env.DWELL_CLAUDE_NONCE = session.nonce;
    const processHandle = pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
    Object.assign(session, {
      process: processHandle,
      pendingBytes: 0,
      paused: false,
      confirming: false,
    });
    contextChanged(state, session);
    processHandle.onData((data) => {
      if (state.sessions.get(id) !== session || session.process !== processHandle) return;
      session.pendingBytes += data.length;
      send(state, 'terminal:data', { id, data });
      if (session.pendingBytes > 512 * 1024 && !session.paused) {
        processHandle.pause();
        session.paused = true;
      }
    });
    processHandle.onExit(({ exitCode }) => {
      if (session.process !== processHandle) return;
      session.process = null;
      session.cwd = null;
      session.claudeLive = false;
      session.nonce = null;
      if (session.worktree) reservedWorktrees.delete(session.worktree.name);
      if (session.status === 'starting') session.status = 'unavailable';
      if (state.sessions.get(id) === session) {
        attention.clear(state, id);
        contextChanged(state, session);
        send(state, 'terminal:exit', { id, exitCode });
      }
    });
    return {
      shell: mode === 'shell' || mode === 'recover' ? path.basename(loginShell) : 'Claude',
      context: publicContext(state, session),
    };
  } catch (error) {
    if (mode === 'worktree') {
      if (session.worktree) reservedWorktrees.delete(session.worktree.name);
      session.status = 'unavailable';
      contextChanged(state, session);
    }
    throw error;
  } finally {
    session.launching = false;
  }
});

handle('terminal:claude', async (state, id, data) => {
  const session = state.sessions.get(id);
  if (!session?.process) return null;
  const event = parseClaudeMessage(data, session.nonce);
  if (!event) return null;
  const starting =
    !session.claudeLive && ['SessionStart', 'UserPromptSubmit'].includes(event.event);
  if (session.closedConversations.has(event.id) && !starting) return null;
  if (session.expectedConversation && event.id !== session.expectedConversation) return null;
  if (
    event.event !== 'SessionStart' &&
    event.id !== session.conversationId &&
    !(event.event === 'UserPromptSubmit' && !session.claudeLive)
  )
    return null;
  if (event.event === 'SessionEnd') {
    session.closedConversations.add(event.id);
    session.claudeLive = false;
    session.cwd = null;
    attention.clear(state, id);
    contextChanged(state, session);
    return publicContext(state, session);
  }
  const nonce = session.nonce;
  let info;
  try {
    info =
      session.claudeLive && session.cwd === event.cwd && event.event !== 'SessionStart'
        ? { root: session.checkoutRoot, cwd: session.cwd, branch: session.branch }
        : await observeDirectory(state.root, event.cwd);
    if (session.unconfirmed) {
      if (
        session.worktree.existing.includes(info.root) ||
        (await git(info.root, ['rev-parse', 'HEAD'])).trim() !== session.worktree.head
      )
        throw new Error('Claude did not enter a new worktree based on the selected HEAD.');
    }
  } catch {
    if (session.nonce === nonce && session.unconfirmed && !session.contextError) {
      session.status = 'unavailable';
      session.contextError =
        'Claude has not confirmed a new worktree based on the selected HEAD. Files remain unavailable; check the terminal output.';
      contextChanged(state, session);
      return publicContext(state, session);
    }
    if (session.nonce === nonce && session.cwd) {
      session.cwd = null;
      contextChanged(state, session);
      return publicContext(state, session);
    }
    return null;
  }
  if (session.nonce !== nonce || !session.process || state.sessions.get(id) !== session)
    return null;
  if (
    event.event === 'SessionStart' &&
    session.conversationId &&
    session.conversationId !== event.id
  ) {
    session.closedConversations.add(session.conversationId);
    attention.clear(state, id);
  }
  const changed =
    session.cwd !== info.cwd ||
    session.checkoutRoot !== info.root ||
    session.conversationId !== event.id ||
    session.branch !== info.branch ||
    session.status !== 'ready';
  Object.assign(session, {
    conversationId: event.id,
    checkoutRoot: info.root,
    cwd: info.cwd,
    branch: info.branch,
    claudeLive: true,
    status: 'ready',
    unconfirmed: false,
    contextError: null,
    launcher: session.launcher || launcherKey(),
  });
  session.closedConversations.delete(event.id);
  session.expectedConversation = null;
  if (changed) contextChanged(state, session);
  if (session.closedConversations.size > 128)
    session.closedConversations.delete(session.closedConversations.values().next().value);
  if (event.status !== null)
    attention.progress(state, id, event.status, session.label, event.reason);
  return publicContext(state, session);
});
handle('terminal:close', async (state, id) => {
  const session = state.sessions.get(id);
  if (!session) return true;
  if (session.confirming) return false;
  if (session.process) {
    session.confirming = true;
    try {
      const { response } = await dialog.showMessageBox(state.window, {
        type: 'question',
        message: 'Close this terminal?',
        detail:
          'The shell and any programs running in this tab will stop. Other terminals will keep running.',
        buttons: ['Keep Open', 'Close Terminal'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response !== 1) return false;
    } finally {
      session.confirming = false;
    }
  }
  try {
    session.process?.kill();
  } catch {}
  state.sessions.delete(id);
  refreshSharedContexts();
  if (session.worktree) reservedWorktrees.delete(session.worktree.name);
  attention.clear(state, id);
  persistTabs(state);
  return true;
});
ipcMain.on('terminal:bell', (event, id, label) => {
  try {
    attention.bell(validState(event), id, label);
  } catch {}
});
ipcMain.on('terminal:progress', (event, id, value, label) => {
  try {
    attention.progress(validState(event), id, value, label);
  } catch {}
});
ipcMain.on('terminal:active', (event, id) => {
  try {
    const state = validState(event);
    if (!state.sessions.has(id)) return;
    if (state.activeSession !== id) detachWatchers(state);
    state.activeSession = id;
    if (!app.isHidden() && state.window.isFocused()) attention.acknowledge(state, id);
  } catch {}
});
ipcMain.on('terminal:input', (event, id, data) => {
  try {
    const state = validState(event);
    const session = state.sessions.get(id);
    if (typeof data === 'string' && data.length <= 2 * 1024 * 1024) {
      // A normal shell can return from Claude without SessionEnd reaching its hidden UI.
      if (
        session?.kind === 'shell' &&
        session.cwd &&
        ['\r', '\n', '\u001b', '\u0003', '\u0004'].some((char) => data.includes(char))
      ) {
        session.cwd = null;
        session.claudeLive = false;
        contextChanged(state, session);
      }
      // Claude does not emit Stop when the user interrupts a turn.
      if (data === '\u0003' || data === '\u001b') attention.interrupt(state, id);
      session?.process?.write(data);
    }
  } catch {}
});
ipcMain.on('terminal:resize', (event, id, cols, rows) => {
  try {
    if (terminalSize(cols, rows)) validState(event).sessions.get(id)?.process?.resize(cols, rows);
  } catch {}
});
ipcMain.on('terminal:ack', (event, id, size) => {
  try {
    const session = validState(event).sessions.get(id);
    if (!session || !Number.isInteger(size) || size < 0) return;
    session.pendingBytes = Math.max(0, session.pendingBytes - size);
    if (session.paused && session.pendingBytes < 64 * 1024 && session.process) {
      session.process.resume();
      session.paused = false;
    }
  } catch {}
});
handle('clipboard:write', async (_state, text) => {
  if (typeof text === 'string' && text.length < 2 * 1024 * 1024) await clipboard.writeText(text);
});
handle('clipboard:read', async () => (await clipboard.readText()).slice(0, 2 * 1024 * 1024));
handle('link:open', async (_state, url) => {
  if (typeof url !== 'string' || url.length > 4096) return;
  const parsed = new URL(url);
  if (['https:', 'http:'].includes(parsed.protocol)) await shell.openExternal(parsed.href);
});

app.whenReady().then(async () => {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
  };
  const allowed = new Set([
    '/index.html',
    '/renderer.js',
    '/renderer.css',
    '/style.css',
    '/dwell-mark.svg',
    '/orb.html',
    '/orb.js',
    '/orb.css',
  ]);
  protocol.handle('dwell', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || !allowed.has(url.pathname))
      return new Response('Not found', { status: 404 });
    return new Response(
      await fsp.readFile(path.join(__dirname, '../dist', url.pathname.slice(1))),
      { headers: { 'Content-Type': types[path.extname(url.pathname)] } },
    );
  });
  const action =
    (name) =>
    (_item, window = BrowserWindow.getFocusedWindow()) => {
      if (window) window.webContents.send('menu:action', name);
    };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Dwell',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Folder…',
            accelerator: 'CmdOrCtrl+O',
            click: () => chooseFolder(BrowserWindow.getFocusedWindow()),
          },
          { label: 'New Terminal', accelerator: 'CmdOrCtrl+T', click: action('new-terminal') },
          { type: 'separator' },
          { label: 'Close Terminal', accelerator: 'CmdOrCtrl+W', click: action('close-terminal') },
          { label: 'Close Window', role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
        ],
      },
      {
        label: 'Terminal',
        submenu: [
          { label: 'New Claude Worktree…', click: action('new-worktree') },
          { label: 'Claude Launcher…', click: action('claude-launcher') },
          {
            label: 'Open File Reference…',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: action('file-reference'),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: action('copy') },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: action('paste') },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle File Tree', accelerator: 'CmdOrCtrl+B', click: action('tree') },
          { label: 'Toggle Preview', accelerator: 'CmdOrCtrl+Shift+P', click: action('preview') },
          { label: 'Show Hidden Files', accelerator: 'CmdOrCtrl+Shift+.', click: action('hidden') },
          { label: 'Focus Terminal', accelerator: 'CmdOrCtrl+J', click: action('terminal') },
          {
            id: 'desktop-orb',
            label: 'Desktop Orb',
            type: 'checkbox',
            checked: preferences.desktopOrb === true,
            click: (item) =>
              attention.setEnabled(item.checked).catch((error) => {
                dialog.showErrorBox('Desktop Orb', error.message);
              }),
          },
          {
            id: 'notification-sound',
            label: 'Notification Sound',
            type: 'checkbox',
            checked: preferences.notificationSound !== false,
            click: (item) => {
              preferences.notificationSound = item.checked;
              savePreferences();
            },
          },
          {
            label: 'Next Terminal',
            accelerator: 'CmdOrCtrl+Shift+]',
            click: action('next-terminal'),
          },
          {
            label: 'Previous Terminal',
            accelerator: 'CmdOrCtrl+Shift+[',
            click: action('previous-terminal'),
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
      {
        role: 'help',
        submenu: [
          {
            id: 'claude-integration',
            label: 'Claude Code Integration',
            type: 'checkbox',
            checked: await isClaudeIntegrationEnabled(claudeConfig).catch(() => false),
            click: async (item) => {
              const enabled = item.checked;
              try {
                await setClaudeIntegration(claudeConfig, enabled);
                await dialog.showMessageBox({
                  type: 'info',
                  message: enabled
                    ? 'Claude Code integration enabled'
                    : 'Claude Code integration disabled',
                  detail: enabled
                    ? 'Start a new Claude session in Dwell. The orb stays cool while working, turns amber when Claude needs you or finishes a response, and red when an API error stops the response. Sounds play for background alerts.\n\nYour other Claude settings and hooks are preserved. These hooks are active only in Dwell.'
                    : 'Dwell’s hooks have been removed. Your other Claude settings and hooks are preserved. Restart existing Claude sessions to apply the change.',
                  buttons: ['OK'],
                });
              } catch (error) {
                item.checked = !enabled;
                dialog.showErrorBox('Claude Code Integration', error.message);
              }
            },
          },
        ],
      },
    ]),
  );
  const arg = process.argv.find((value) => value.startsWith('--project='));
  await createWindow(arg ? arg.slice(10) : preferences.lastRoot);
  if (preferences.desktopOrb) await attention.setEnabled(true);
});
app.on('activate', () => {
  if (!windows.size) createWindow(preferences.lastRoot);
});
app.on('window-all-closed', () => app.quit());
