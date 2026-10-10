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
    constructor() {
      super();
      nativeWindows.push(this);
      this.messages = [];
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
    async enable() {
      await attention.setEnabled(true);
    },
    orb() {
      return nativeWindows.at(-1);
    },
    status() {
      return this.orb()
        .messages.filter(({ channel }) => channel === 'orb:state')
        .at(-1).value;
    },
    open(event) {
      const sender = this.orb().webContents;
      ipcMain.emit('orb:open', event || { sender, senderFrame: sender.mainFrame });
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
