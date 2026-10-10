const { BrowserWindow, Menu, Notification, ipcMain, screen, app } = require('electron');
const path = require('node:path');

function createAttention(windows, preferences, savePreferences) {
  const pending = new Map();
  let orb;
  let drag;

  function update() {
    if (!orb || orb.isDestroyed()) return;
    const first = pending.values().next().value;
    orb.webContents.send('orb:state', {
      count: pending.size,
      label: first ? `${path.basename(first.state.root)} · ${first.label}` : 'Dwell',
    });
  }

  function clear(state, id) {
    for (const [key, item] of pending) {
      if (item.state !== state || (id && item.id !== id)) continue;
      item.notification?.close();
      pending.delete(key);
      if (!state.window.isDestroyed())
        state.window.webContents.send('terminal:attention', { id: item.id, pending: false });
    }
    update();
  }

  function open(item) {
    const state = item?.state || [...windows.values()].at(-1);
    if (!state || state.window.isDestroyed()) return;
    if (item && state.sessions.has(item.id))
      state.window.webContents.send('terminal:focus', item.id);
    if (state.window.isMinimized()) state.window.restore();
    state.window.show();
    app.focus({ steal: true });
    state.window.focus();
    if (item && state.sessions.has(item.id)) {
      clear(state, item.id);
    }
  }

  function bell(state, id, label) {
    if (!state.sessions.has(id) || (state.window.isFocused() && state.activeSession === id)) return;
    const key = `${state.window.webContents.id}:${id}`;
    if (pending.has(key)) return;
    const item = { state, id, label: typeof label === 'string' ? label.slice(0, 80) : 'Terminal' };
    pending.set(key, item);
    state.window.webContents.send('terminal:attention', { id, pending: true });
    update();
    if (!orb && !state.window.isFocused() && Notification.isSupported()) {
      const notification = new Notification({
        title: 'Dwell · Terminal needs attention',
        body: `${path.basename(state.root)} · ${item.label}`,
        silent: true,
      });
      item.notification = notification;
      notification.on('click', () => open(item));
      notification.show();
    }
  }

  function position(x, y) {
    const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
    return {
      x: Math.round(Math.max(area.x, Math.min(area.x + area.width - 88, x))),
      y: Math.round(Math.max(area.y, Math.min(area.y + area.height - 88, y))),
    };
  }

  function destroyOrb() {
    drag = null;
    if (!orb) return;
    const previous = orb;
    orb = null;
    previous.destroy();
  }

  async function setEnabled(enabled) {
    preferences.desktopOrb = enabled === true;
    savePreferences();
    const item = Menu.getApplicationMenu()?.getMenuItemById('desktop-orb');
    if (item) item.checked = preferences.desktopOrb;
    if (!preferences.desktopOrb) {
      destroyOrb();
      return;
    }
    if (orb) return;
    const area = screen.getPrimaryDisplay().workArea;
    const saved = preferences.orbPosition;
    const point =
      saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? position(saved.x, saved.y)
        : position(area.x + area.width - 112, area.y + area.height - 112);
    const window = new BrowserWindow({
      ...point,
      width: 88,
      height: 88,
      title: 'Dwell Desktop Orb',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'orb-preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    orb = window;
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('context-menu', () =>
      Menu.buildFromTemplate([{ label: 'Hide Desktop Orb', click: () => setEnabled(false) }]).popup(
        { window },
      ),
    );
    window.on('closed', () => {
      if (orb === window) orb = null;
    });
    try {
      await window.loadURL('dwell://app/orb.html');
    } catch (error) {
      if (orb !== window || window.isDestroyed()) return;
      destroyOrb();
      throw error;
    }
    if (orb !== window || window.isDestroyed()) return;
    update();
    window.showInactive();
    for (const item of pending.values()) item.notification?.close();
  }

  function validOrb(event) {
    return (
      orb &&
      !orb.isDestroyed() &&
      event.sender === orb.webContents &&
      event.senderFrame === orb.webContents.mainFrame &&
      event.senderFrame.url === 'dwell://app/orb.html'
    );
  }
  ipcMain.on('orb:open', (event) => {
    if (validOrb(event)) open(pending.values().next().value);
  });
  ipcMain.on('orb:drag', (event, phase) => {
    if (!validOrb(event)) return;
    if (phase === 'start')
      drag = { cursor: screen.getCursorScreenPoint(), bounds: orb.getBounds() };
    if (phase === 'move' && drag) {
      const cursor = screen.getCursorScreenPoint();
      const point = position(
        drag.bounds.x + cursor.x - drag.cursor.x,
        drag.bounds.y + cursor.y - drag.cursor.y,
      );
      orb.setPosition(point.x, point.y);
    }
    if (phase === 'end' && drag) {
      const [x, y] = orb.getPosition();
      preferences.orbPosition = { x, y };
      drag = null;
      savePreferences();
    }
  });
  return { bell, clear, setEnabled, destroyOrb };
}

module.exports = { createAttention };
