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
const pty = require('node-pty');
const { resolveFile, listFiles, readPreview, friendlyError, quotePaths } = require('./files.cjs');
const { listChanges, readDiff } = require('./git.cjs');
const { createAttention } = require('./attention.cjs');

app.setName('Dwell');
nativeTheme.themeSource = 'dark';
if (process.env.DWELL_USER_DATA) app.setPath('userData', process.env.DWELL_USER_DATA);
protocol.registerSchemesAsPrivileged([
  { scheme: 'dwell', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const windows = new Map();
let preferences = { projects: {} };
const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
try {
  preferences = { projects: {}, ...JSON.parse(fs.readFileSync(preferencesPath, 'utf8')) };
} catch {}
const attention = createAttention(windows, preferences, savePreferences);

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
  return {
    root: state.root,
    name: state.root ? path.basename(state.root) : 'Dwell',
    home: os.homedir(),
    settings: preferences.projects[state.root] || {},
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

handle('project:get', (state) => getProject(state));
handle('project:choose', (state) => chooseFolder(state.window));
handle('git:changes', (state) => listChanges(state.root));
handle('git:diff', (state, relative) => readDiff(state.root, relative));
handle('files:reference', async (state, relative) => {
  if (!state.root) throw new Error('Open a folder first.');
  return quotePaths([await resolveFile(state.root, relative)]);
});
handle('files:quote', (_state, paths) => quotePaths(paths));
handle('files:list', (state, relative, hidden) => {
  if (!state.root) throw new Error('Open a folder first.');
  return listFiles(state.root, relative, hidden === true);
});
handle('files:preview', async (state, relative) => {
  if (!state.root) throw new Error('Open a folder first.');
  const preview = await readPreview(state.root, relative);
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
handle('files:open', async (state, relative) => {
  const filename = await resolveFile(state.root, relative);
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
handle('files:reveal', async (state, relative) =>
  shell.showItemInFolder(await resolveFile(state.root, relative)),
);
handle('files:watch', async (state, directories) => {
  if (!state.root || !Array.isArray(directories)) return;
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
      const directory = await resolveFile(state.root, relative);
      const stat = await fsp.stat(directory);
      if (version !== state.watchVersion || state.window.isDestroyed()) return;
      const existing = state.watchers.get(relative);
      if (existing?.dwellInode === stat.ino) continue;
      existing?.close();
      const watcher = fs.watch(directory, () => {
        if (!state.watchTimer)
          state.watchTimer = setTimeout(() => {
            state.watchTimer = null;
            send(state, 'files:changed', null);
          }, 140);
      });
      watcher.dwellInode = stat.ino;
      watcher.on('error', () => {
        watcher.close();
        state.watchers.delete(relative);
      });
      state.watchers.set(relative, watcher);
    } catch {
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
    terminalNames: Array.isArray(value.terminalNames)
      ? value.terminalNames
          .slice(0, 32)
          .filter((name) => typeof name === 'string')
          .map((name) => name.trim().slice(0, 80))
      : [],
    selected: typeof value.selected === 'string' ? value.selected : null,
  };
  preferences.projects[state.root] = settings;
  savePreferences();
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
handle('terminal:start', (state, id, cols, rows) => {
  if (!state.root) throw new Error('Open a folder first.');
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || state.sessions.has(id))
    throw new Error('Invalid terminal session.');
  if (state.sessions.size >= 32) throw new Error('Up to 32 terminals can be open in one window.');
  if (!terminalSize(cols, rows)) throw new Error('Invalid terminal dimensions.');
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Dwell',
    TERM_PROGRAM_VERSION: app.getVersion(),
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
  const loginShell = process.env.SHELL || '/bin/zsh';
  const processHandle = pty.spawn(loginShell, ['-l'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: state.root,
    env,
  });
  const session = { process: processHandle, pendingBytes: 0, paused: false, confirming: false };
  state.sessions.set(id, session);
  processHandle.onData((data) => {
    if (state.sessions.get(id) !== session) return;
    session.pendingBytes += data.length;
    send(state, 'terminal:data', { id, data });
    if (session.pendingBytes > 512 * 1024 && !session.paused) {
      processHandle.pause();
      session.paused = true;
    }
  });
  processHandle.onExit(({ exitCode }) => {
    session.process = null;
    if (state.sessions.get(id) === session) send(state, 'terminal:exit', { id, exitCode });
  });
  return { shell: path.basename(loginShell) };
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
  attention.clear(state, id);
  return true;
});
ipcMain.on('terminal:bell', (event, id, label) => {
  try {
    attention.bell(validState(event), id, label);
  } catch {}
});
ipcMain.on('terminal:active', (event, id) => {
  try {
    const state = validState(event);
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return;
    state.activeSession = id;
    if (state.window.isFocused()) attention.clear(state, id);
  } catch {}
});
ipcMain.on('terminal:input', (event, id, data) => {
  try {
    const session = validState(event).sessions.get(id);
    if (typeof data === 'string' && data.length <= 2 * 1024 * 1024) session?.process?.write(data);
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
            label: 'Claude Code Alerts…',
            click: () =>
              dialog.showMessageBox({
                type: 'info',
                message: 'Let Claude Code notify Dwell',
                detail:
                  'In your Claude Code settings (~/.claude/settings.json), set "preferredNotifChannel" to "terminal_bell".\n\nDwell marks the terminal that needs attention. Enable View → Desktop Orb for a quiet desktop indicator; click it to return to that terminal. Drag the orb to move it, or right-click to hide it.\n\nWhen the orb is off, background alerts use macOS notifications.',
                buttons: ['OK'],
              }),
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
