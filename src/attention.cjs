const { BrowserWindow, Menu, Notification, ipcMain, screen, app } = require('electron');
const path = require('node:path');
const childProcess = require('node:child_process');

function createAttention(windows, preferences, savePreferences) {
  const items = new Map();
  let orb;
  let drag;
  let lastSound = 0;
  let cardAnchor;
  let workspaceWindow;
  let orbDisplay;
  const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
  const displaysChanged = () => reposition();
  const reasons = {
    approval: 'Approval requested',
    question: 'Question',
    plan: 'Plan to review',
    response: 'Response ready',
    error: 'Response interrupted',
    attention: 'Needs attention',
    none: 'Working',
  };

  function status(item) {
    return item.acknowledged && item.status !== 'working' ? 'idle' : item.status;
  }

  function first() {
    const priority = { idle: 0, working: 1, attention: 2, error: 3 };
    let selected;
    for (const item of items.values()) {
      const level = priority[status(item)];
      const current = selected ? priority[status(selected)] : 0;
      if (level > current || (level && level === current && item.pending && !selected.pending))
        selected = item;
    }
    return selected;
  }

  function update() {
    if (!orb || orb.isDestroyed()) return;
    const item = first();
    const session = item?.state.sessions.get(item.id);
    const label = session?.label || item?.label;
    orb.webContents.send('orb:state', {
      count: [...items.values()].filter((entry) => entry.pending).length,
      status: item ? status(item) : 'idle',
      label: item ? `${path.basename(item.state.root)} · ${label}` : 'Dwell',
      target: item ? `${item.state.window.webContents.id}:${item.id}` : null,
      project: item ? path.basename(item.state.root) : 'Dwell',
      checkout: item
        ? [session?.branch || (session?.checkoutRoot && path.basename(session.checkoutRoot)), label]
            .filter(Boolean)
            .join(' · ')
        : '',
      reason: item ? reasons[item.reason] || 'Needs attention' : 'No session needs attention',
    });
    if (!item) showCard(false);
  }

  function dismiss(item) {
    item.notification?.close();
    item.notification = null;
    item.pending = false;
  }

  function report(item, currentStatus = item.status) {
    if (!item.state.window.isDestroyed())
      item.state.window.webContents.send('terminal:attention', {
        id: item.id,
        pending: item.pending,
        status: currentStatus,
        reason: currentStatus === 'idle' ? '' : reasons[item.reason] || 'Needs attention',
      });
  }

  function clear(state, id) {
    for (const [key, item] of items) {
      if (item.state !== state || (id && item.id !== id)) continue;
      dismiss(item);
      report(item, 'idle');
      items.delete(key);
    }
    update();
  }

  function acknowledge(state, id) {
    const key = `${state.window.webContents.id}:${id}`;
    const item = items.get(key);
    if (!item) return;
    dismiss(item);
    item.acknowledged = true;
    report(item, item.typed ? item.status : 'idle');
    if (!item.typed) items.delete(key);
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
      acknowledge(state, item.id);
    }
  }

  function signal(
    state,
    id,
    label,
    nextStatus,
    typed,
    reason = nextStatus === 'error' ? 'error' : nextStatus === 'working' ? 'none' : 'attention',
  ) {
    if (!state.sessions.get(id)?.process) return;
    const focused = !app.isHidden() && state.window.isFocused();
    const key = `${state.window.webContents.id}:${id}`;
    const previous = items.get(key);
    if (!typed && (previous?.typed || (focused && state.activeSession === id))) return;
    if (typed && previous?.status === 'error' && nextStatus === 'attention') return;
    if (previous?.status === nextStatus && previous.typed === typed) {
      if (reason !== 'attention' && reason !== previous.reason) {
        previous.reason = reason;
        previous.acknowledged = false;
        previous.pending = !(focused && state.activeSession === id);
        report(previous);
        update();
      }
      return;
    }
    if (previous) dismiss(previous);
    const alert = nextStatus === 'attention' || nextStatus === 'error';
    const item = {
      state,
      id,
      typed,
      reason,
      status: nextStatus,
      acknowledged: false,
      pending: alert && !(focused && state.activeSession === id),
      label: typeof label === 'string' ? label.slice(0, 80) : 'Terminal',
    };
    items.set(key, item);
    report(item);
    update();
    if (!item.pending) return;
    if (preferences.notificationSound !== false && Date.now() - lastSound > 1500) {
      lastSound = Date.now();
      childProcess.execFile(
        '/usr/bin/afplay',
        [path.join(app.isPackaged ? process.resourcesPath : __dirname, 'orb-notification.wav')],
        (error) => {
          if (error) console.error('Could not play notification sound:', error.message);
        },
      );
    }
    if ((!orb?.isVisible() || app.isHidden()) && !focused && Notification.isSupported()) {
      const notification = new Notification({
        title:
          nextStatus === 'error'
            ? 'Dwell · Response interrupted'
            : 'Dwell · Terminal needs attention',
        body: `${path.basename(state.root)} · ${item.label}`,
        silent: true,
      });
      item.notification = notification;
      notification.on('click', () => open(item));
      notification.show();
    }
  }

  function progress(state, id, value, label, reason) {
    if (!state.sessions.get(id)?.process || !Number.isInteger(value) || value < 0 || value > 4)
      return;
    if (value === 0) clear(state, id);
    else
      signal(
        state,
        id,
        label,
        ['idle', 'working', 'error', 'working', 'attention'][value],
        true,
        Object.hasOwn(reasons, reason) ? reason : undefined,
      );
  }

  function interrupt(state, id) {
    if (items.get(`${state.window.webContents.id}:${id}`)?.typed) clear(state, id);
  }

  function bell(state, id, label) {
    signal(state, id, label, 'attention', false);
  }

  function position(
    x,
    y,
    area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea,
  ) {
    return {
      x: Math.round(Math.max(area.x, Math.min(area.x + area.width - 88, x))),
      y: Math.round(Math.max(area.y, Math.min(area.y + area.height - 88, y))),
    };
  }

  function reposition(window) {
    if (window) workspaceWindow = window;
    if (!orb || orb.isDestroyed()) return;
    if (!workspaceWindow || workspaceWindow.isDestroyed())
      workspaceWindow = [...windows.values()].at(-1)?.window;
    const display = workspaceWindow
      ? screen.getDisplayMatching(workspaceWindow.getBounds())
      : screen.getPrimaryDisplay();
    const area = display.workArea;
    const layout = [display.id, area.x, area.y, area.width, area.height].join(':');
    if (layout === orbDisplay) return;
    orbDisplay = layout;
    drag = null;
    showCard(false);
    const saved = preferences.orbPosition;
    // Old absolute coordinates cannot identify the screen they belonged to.
    const restore =
      saved?.displayId === display.id &&
      Number.isFinite(saved.right) &&
      saved.right >= 0 &&
      Number.isFinite(saved.bottom) &&
      saved.bottom >= 0;
    const point = position(
      area.x + area.width - 88 - (restore ? saved.right : 24),
      area.y + area.height - 88 - (restore ? saved.bottom : 24),
      area,
    );
    orb.setPosition(point.x, point.y);
  }

  function destroyOrb() {
    drag = null;
    cardAnchor = null;
    orbDisplay = null;
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
    const window = new BrowserWindow({
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
      focusable: true,
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
    reposition();
    for (const event of displayEvents) screen.on(event, displaysChanged);
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
      for (const event of displayEvents) screen.removeListener(event, displaysChanged);
      if (orb === window) orb = null;
    });
    window.on('hide', () => showCard(false));
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
    for (const item of items.values()) item.notification?.close();
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
  function showCard(visible) {
    if (!orb || orb.isDestroyed()) return;
    if (!visible) {
      if (cardAnchor) {
        orb.setBounds({ ...cardAnchor, width: 88, height: 88 });
        cardAnchor = null;
        orb.webContents.send('orb:layout', null);
      }
      return;
    }
    update();
    if (cardAnchor || drag || !first()) return;
    const [x, y] = orb.getPosition();
    cardAnchor = { x, y };
    const area = screen.getDisplayNearestPoint({ x, y }).workArea;
    const width = 354;
    const height = 120;
    const left = x - area.x >= width - 88;
    const bounds = {
      x: Math.max(area.x, Math.min(area.x + area.width - width, left ? x - (width - 88) : x)),
      y: Math.max(area.y, Math.min(area.y + area.height - height, y - 16)),
      width,
      height,
    };
    orb.setBounds(bounds);
    orb.webContents.send('orb:layout', { x: x - bounds.x, y: y - bounds.y, cardX: left ? 0 : 100 });
  }
  ipcMain.on('orb:card', (event, visible) => {
    if (validOrb(event)) showCard(visible === true);
  });
  ipcMain.on('orb:open', (event, target) => {
    if (validOrb(event)) {
      const item = typeof target === 'string' ? items.get(target) : first();
      if (typeof target === 'string' && !item) return;
      showCard(false);
      open(item);
    }
  });
  ipcMain.on('orb:drag', (event, phase) => {
    if (!validOrb(event)) return;
    if (phase === 'start') {
      showCard(false);
      drag = { cursor: screen.getCursorScreenPoint(), bounds: orb.getBounds() };
    }
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
      const display = screen.getDisplayMatching(orb.getBounds());
      const area = display.workArea;
      preferences.orbPosition = {
        displayId: display.id,
        right: area.x + area.width - 88 - x,
        bottom: area.y + area.height - 88 - y,
      };
      drag = null;
      savePreferences();
    }
  });
  return { bell, progress, interrupt, acknowledge, clear, setEnabled, destroyOrb, reposition };
}

module.exports = { createAttention };
