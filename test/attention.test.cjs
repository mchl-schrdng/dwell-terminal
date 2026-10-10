const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function fixture() {
  const windows = new Map();
  const nativeWindows = [];
  const notifications = [];
  const sounds = [];
  const preferences = {};
  const ipcMain = new EventEmitter();
  let now = 10000;
  const app = {
    hidden: false,
    isHidden: () => app.hidden,
    focus: () => (app.hidden = false),
  };
  class Window extends EventEmitter {
    constructor(options = {}) {
      super();
      nativeWindows.push(this);
      this.messages = [];
      this.bounds = { x: 0, y: 0, ...options };
      this.webContents = new EventEmitter();
      this.webContents.id = nativeWindows.length;
      this.webContents.mainFrame = {};
      this.webContents.send = (channel, value) => this.messages.push({ channel, value });
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() {
      return this.destroyed === true;
    }
    isVisible() {
      return this.visible === true;
    }
    isFocused() {
      return this.focused === true;
    }
    isMinimized() {
      return false;
    }
    show() {
      this.visible = true;
    }
    showInactive() {
      this.show();
    }
    focus() {
      for (const window of nativeWindows) window.focused = window === this;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    getPosition() {
      return [this.bounds.x, this.bounds.y];
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    async loadURL(url) {
      this.webContents.mainFrame.url = url;
    }
  }
  class Notification extends EventEmitter {
    constructor(options) {
      super();
      Object.assign(this, options);
      notifications.push(this);
    }
    static isSupported() {
      return true;
    }
    show() {
      this.shown = true;
    }
    close() {
      this.closed = true;
    }
  }
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const dependencies = {
    electron: {
      BrowserWindow: Window,
      Notification,
      ipcMain,
      app,
      Menu: { getApplicationMenu: () => null },
      screen: {
        getPrimaryDisplay: () => ({ workArea: area }),
        getDisplayNearestPoint: () => ({ workArea: area }),
      },
    },
    'node:path': path,
    'node:child_process': {
      execFile: (file, args, callback) => {
        sounds.push({ file, args });
        callback(null);
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/attention.cjs'), 'utf8'), {
    module,
    __dirname: path.join(__dirname, '../src'),
    console,
    Date: { now: () => now },
    require: (name) => {
      assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const attention = module.exports.createAttention(windows, preferences, () => {});
  const state = { window: new Window(), root: '/projects/alpha', sessions: new Map() };
  windows.set(state.window.webContents.id, state);
  const first = '11111111-1111-1111-1111-111111111111';
  const second = '22222222-2222-2222-2222-222222222222';
  for (const id of [first, second]) state.sessions.set(id, { process: {} });
  state.activeSession = first;
  return {
    attention,
    state,
    first,
    second,
    preferences,
    notifications,
    sounds,
    app,
    advance: (ms) => (now += ms),
    terminalEvents() {
      return state.window.messages
        .filter(({ channel }) => channel === 'terminal:attention')
        .map(({ value }) => ({ ...value }));
    },
    async enable() {
      await attention.setEnabled(true);
    },
    addWindow() {
      const other = { window: new Window(), root: '/projects/beta', sessions: new Map() };
      windows.set(other.window.webContents.id, other);
      return other;
    },
    orb() {
      return nativeWindows.findLast(
        (window) => window.webContents.mainFrame.url === 'dwell://app/orb.html',
      );
    },
    status() {
      return this.orb()
        .messages.filter(({ channel }) => channel === 'orb:state')
        .at(-1).value;
    },
    open(event, target) {
      const sender = this.orb().webContents;
      ipcMain.emit('orb:open', event || { sender, senderFrame: sender.mainFrame }, target);
    },
    card(visible) {
      const sender = this.orb().webContents;
      ipcMain.emit('orb:card', { sender, senderFrame: sender.mainFrame }, visible);
    },
  };
}

test('working survives acknowledgement; foreground alerts stay visible without sound', async () => {
  const f = fixture();
  await f.enable();
  f.state.window.focus();
  f.attention.progress(f.state, f.first, 3, 'Claude');
  f.attention.acknowledge(f.state, f.first);
  assert.equal(f.status().status, 'working');
  f.attention.progress(f.state, f.first, 4, 'Claude');
  assert.equal(f.status().status, 'attention');
  assert.equal(f.status().count, 0);
  assert.equal(f.sounds.length, 0);
  f.attention.acknowledge(f.state, f.first);
  assert.equal(f.status().status, 'idle');
  f.attention.progress(f.state, f.first, 4, 'Claude');
  assert.equal(
    f.status().status,
    'idle',
    'the delayed idle event does not repeat an acknowledged alert',
  );
  f.attention.progress(f.state, f.first, 3, 'Claude');
  f.attention.progress(f.state, f.first, 2, 'Claude');
  assert.equal(f.status().status, 'error');
  assert.equal(f.sounds.length, 0);
});

test('the orb opens the highest priority terminal and preserves the other session', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 4, 'Earlier');
  f.attention.progress(f.state, f.second, 2, 'Error');
  assert.equal(f.status().status, 'error');
  assert.equal(f.status().label, 'alpha · Error');
  assert.equal(f.status().count, 2);
  f.attention.progress(f.state, f.second, 4, 'Delayed idle');
  assert.equal(f.status().status, 'error', 'a later idle notification cannot hide an API error');
  f.open({ sender: f.state.window.webContents, senderFrame: f.state.window.webContents.mainFrame });
  assert.equal(f.status().count, 2, 'another renderer cannot operate the orb');
  f.open();
  assert.equal(
    f.state.window.messages.filter(({ channel }) => channel === 'terminal:focus').at(-1).value,
    f.second,
  );
  assert.equal(f.status().status, 'attention');
  assert.equal(f.status().count, 1);
  f.attention.progress(f.state, f.second, 3, 'Working');
  f.open();
  assert.equal(f.status().status, 'working');
  assert.equal(f.status().count, 0);
});

test('an unread request wins over a visible request of equal severity', async () => {
  const f = fixture();
  await f.enable();
  f.state.window.focus();
  f.attention.progress(f.state, f.first, 4, 'Visible', 'response');
  f.attention.progress(f.state, f.second, 4, 'Waiting', 'approval');
  assert.equal(f.status().count, 1);
  assert.equal(f.status().reason, 'Approval requested');
  assert.equal(f.status().target, `${f.state.window.webContents.id}:${f.second}`);
  f.open();
  assert.equal(
    f.state.window.messages.filter(({ channel }) => channel === 'terminal:focus').at(-1).value,
    f.second,
  );
  assert.equal(f.status().count, 0);
});

test('a stale card target never falls back to an unrelated window', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 4, 'Claude', 'approval');
  const target = f.status().target;
  const other = f.addWindow();
  f.attention.clear(f.state, f.first);
  f.open(undefined, target);
  assert.equal(f.state.window.isFocused(), false);
  assert.equal(other.window.isFocused(), false);
  f.open();
  assert.equal(other.window.isFocused(), true, 'an idle orb still opens Dwell');
});

test('the card reads the current tab name and checkout without replaying an alert', async () => {
  const f = fixture();
  await f.enable();
  const session = f.state.sessions.get(f.first);
  Object.assign(session, { label: 'Original', branch: 'old-branch' });
  f.attention.progress(f.state, f.first, 4, session.label, 'approval');
  session.label = 'Renamed';
  f.attention.progress(f.state, f.first, 4, session.label, 'plan');
  assert.equal(f.status().label, 'alpha · Renamed');
  Object.assign(session, { label: 'Current task', branch: 'new-branch' });
  f.card(true);
  assert.equal(f.status().label, 'alpha · Current task');
  assert.equal(f.status().checkout, 'new-branch · Current task');
  assert.equal(f.status().reason, 'Plan to review');
  assert.equal(f.status().count, 1);
  assert.equal(f.sounds.length, 1);
  f.card(false);
  assert.equal(f.orb().bounds.width, 88);
});

test('typed duplicate suppression ends on reset and interrupt, preserving generic BEL', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 4, 'Claude');
  f.attention.bell(f.state, f.first, 'Claude');
  f.attention.progress(f.state, f.first, 4, 'Claude');
  assert.equal(f.status().count, 1);
  assert.equal(f.sounds.length, 1);
  f.attention.acknowledge(f.state, f.first);
  f.attention.bell(f.state, f.first, 'Delayed Claude bell');
  assert.equal(f.status().count, 0);
  f.attention.progress(f.state, f.first, 0, 'Claude');
  f.attention.bell(f.state, f.first, 'Shell');
  assert.equal(f.status().count, 1);
  f.attention.progress(f.state, f.first, 3, 'Claude');
  f.attention.interrupt(f.state, f.first);
  assert.equal(f.status().status, 'idle');
  f.attention.bell(f.state, f.first, 'Shell');
  assert.equal(f.status().count, 1);
});

test('new alerts respect mute and the sound cooldown while severity can escalate', () => {
  const f = fixture();
  f.attention.progress(f.state, f.first, 4, 'Claude');
  assert.equal(f.sounds.length, 1);
  f.advance(500);
  f.attention.progress(f.state, f.first, 2, 'Claude');
  assert.equal(f.sounds.length, 1);
  assert.equal(f.notifications[0].closed, true);
  assert.equal(f.notifications.at(-1).title, 'Dwell · Response interrupted');
  f.advance(1001);
  f.attention.bell(f.state, f.second, 'Shell');
  assert.equal(f.sounds.length, 2);
  assert.equal(f.sounds[0].file, '/usr/bin/afplay');
  assert.equal(path.basename(f.sounds[0].args[0]), 'orb-notification.wav');
  f.preferences.notificationSound = false;
  f.advance(2000);
  f.attention.progress(f.state, f.first, 3, 'Claude');
  f.attention.progress(f.state, f.first, 2, 'Claude');
  assert.equal(f.sounds.length, 2);
});

test('a hidden app still notifies and recovery dismisses its native notification', async () => {
  const f = fixture();
  await f.enable();
  f.state.window.focus();
  f.app.hidden = true;
  f.attention.progress(f.state, f.first, 2, 'Claude');
  assert.equal(f.status().count, 1);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].silent, true);
  f.attention.progress(f.state, f.first, 3, 'Claude');
  assert.equal(f.notifications[0].closed, true);
  assert.equal(f.status().status, 'working');
  assert.equal(f.status().count, 0);
  f.attention.progress(f.state, f.first, 4, 'Claude');
  f.notifications.at(-1).emit('click');
  assert.equal(f.app.hidden, false);
  assert.equal(f.status().status, 'idle');
});

test('invalid messages and delayed output from dead or closed terminals cannot change state', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 3, 'Claude');
  for (const value of [-1, 5, 3.5, '4', null, NaN]) f.attention.progress(f.state, f.first, value);
  for (const id of [undefined, null, '', 'unknown']) f.attention.progress(f.state, id, 0);
  assert.equal(f.status().status, 'working');
  f.state.sessions.get(f.first).process = null;
  f.attention.clear(f.state, f.first);
  f.attention.progress(f.state, f.first, 4, 'Late output');
  f.attention.bell(f.state, f.first, 'Late bell');
  f.state.sessions.delete(f.second);
  f.attention.progress(f.state, f.second, 2, 'Closed');
  assert.equal(f.status().status, 'idle');
  assert.equal(f.sounds.length, 0);
});

test('orb visibility does not discard session state and window cleanup removes it', async () => {
  const f = fixture();
  f.attention.progress(f.state, f.first, 2, 'Claude');
  await f.enable();
  assert.equal(f.status().status, 'error');
  await f.attention.setEnabled(false);
  f.attention.progress(f.state, f.second, 3, 'Other Claude');
  await f.enable();
  assert.equal(f.status().status, 'error');
  f.attention.clear(f.state, f.first);
  assert.equal(f.status().status, 'working');
  f.attention.clear(f.state);
  assert.equal(f.status().status, 'idle');
  assert.equal(f.status().count, 0);
});

test('semantic reasons update quietly without weakening a specific alert or error', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 4, 'Claude', 'approval');
  assert.equal(f.status().reason, 'Approval requested');
  f.advance(2000);
  f.attention.progress(f.state, f.first, 4, 'Claude', 'plan');
  assert.equal(f.status().reason, 'Plan to review');
  assert.equal(f.sounds.length, 1);
  f.attention.progress(f.state, f.first, 4, 'Claude', 'attention');
  assert.equal(f.status().reason, 'Plan to review');
  f.attention.progress(f.state, f.first, 4, 'Claude', 'question');
  assert.equal(f.status().reason, 'Question');
  f.attention.progress(f.state, f.first, 3, 'Claude', 'none');
  assert.equal(f.status().reason, 'Working');
  f.attention.progress(f.state, f.first, 2, 'Claude', 'error');
  assert.equal(f.status().reason, 'Response interrupted');
  f.attention.progress(f.state, f.first, 4, 'Claude', 'response');
  assert.equal(f.status().reason, 'Response interrupted');
  f.attention.clear(f.state, f.first);
  assert.equal(f.status().status, 'idle');
});

test('terminal attention carries semantic reasons without transient idle or duplicate events', () => {
  const f = fixture();
  f.attention.progress(f.state, f.first, 3, 'Claude', 'none');
  f.attention.progress(f.state, f.first, 4, 'Claude', 'approval');
  f.advance(2000);
  f.attention.progress(f.state, f.first, 4, 'Claude', 'plan');
  f.attention.progress(f.state, f.first, 4, 'Claude', 'attention');
  f.attention.progress(f.state, f.first, 4, 'Claude', 'plan');
  f.attention.bell(f.state, f.first, 'Delayed bell');
  assert.deepEqual(f.terminalEvents(), [
    { id: f.first, pending: false, status: 'working', reason: 'Working' },
    { id: f.first, pending: true, status: 'attention', reason: 'Approval requested' },
    { id: f.first, pending: true, status: 'attention', reason: 'Plan to review' },
  ]);
  assert.equal(f.sounds.length, 1, 'refining the reason does not play a second sound');
  f.attention.progress(f.state, f.first, 2, 'Claude', 'error');
  f.attention.progress(f.state, f.first, 4, 'Claude', 'response');
  assert.deepEqual(f.terminalEvents().slice(3), [
    { id: f.first, pending: true, status: 'error', reason: 'Response interrupted' },
  ]);
});

test('acknowledgement preserves Claude meaning for the terminal while settling the orb', async () => {
  const f = fixture();
  await f.enable();
  for (const [value, status, reason, label] of [
    [3, 'working', 'none', 'Working'],
    [4, 'attention', 'response', 'Response ready'],
    [2, 'error', 'error', 'Response interrupted'],
  ]) {
    f.attention.progress(f.state, f.first, value, 'Claude', reason);
    f.attention.acknowledge(f.state, f.first);
    assert.deepEqual(f.terminalEvents().at(-1), {
      id: f.first,
      pending: false,
      status,
      reason: label,
    });
    assert.equal(f.status().status, status === 'working' ? 'working' : 'idle');
  }
  f.attention.bell(f.state, f.second, 'Shell');
  f.attention.acknowledge(f.state, f.second);
  assert.deepEqual(f.terminalEvents().at(-1), {
    id: f.second,
    pending: false,
    status: 'idle',
    reason: '',
  });
});

test('recovery replaces a stale reason and reset, interruption and cleanup explicitly clear it', () => {
  const f = fixture();
  f.attention.progress(f.state, f.first, 2, 'Claude', 'error');
  f.attention.progress(f.state, f.first, 3, 'Claude', 'none');
  assert.deepEqual(f.terminalEvents().slice(1), [
    { id: f.first, pending: false, status: 'working', reason: 'Working' },
  ]);
  for (const clear of [
    () => f.attention.progress(f.state, f.first, 0),
    () => f.attention.interrupt(f.state, f.first),
    () => f.attention.clear(f.state, f.first),
    () => f.attention.clear(f.state),
  ]) {
    f.attention.progress(f.state, f.first, 4, 'Claude', 'response');
    f.attention.acknowledge(f.state, f.first);
    clear();
    assert.deepEqual(f.terminalEvents().at(-1), {
      id: f.first,
      pending: false,
      status: 'idle',
      reason: '',
    });
  }
});
