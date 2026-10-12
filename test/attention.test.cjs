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
    getBounds() {
      return this.bounds;
    }
    setPosition(x, y) {
      Object.assign(this.bounds, { x, y });
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
  const displays = [{ id: 1, workArea: area }];
  const screen = new EventEmitter();
  screen.getPrimaryDisplay = () => displays[0];
  screen.getCursorScreenPoint = () => screen.cursor;
  screen.getDisplayNearestPoint = ({ x, y }) => {
    const distance = ({ workArea: a }) =>
      Math.hypot(Math.max(a.x - x, 0, x - a.x - a.width), Math.max(a.y - y, 0, y - a.y - a.height));
    return displays.toSorted((a, b) => distance(a) - distance(b))[0];
  };
  screen.getDisplayMatching = ({ x, y, width = 0, height = 0 }) =>
    screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 });
  const dependencies = {
    electron: {
      BrowserWindow: Window,
      Notification,
      ipcMain,
      app,
      Menu: { getApplicationMenu: () => null },
      screen,
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
    screen,
    displays,
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
    drag(phase, cursor = { x: 0, y: 0 }) {
      screen.cursor = cursor;
      const sender = this.orb().webContents;
      ipcMain.emit('orb:drag', { sender, senderFrame: sender.mainFrame }, phase);
    },
  };
}

test('the orb starts on the workspace display and follows it between screens', async () => {
  const f = fixture();
  f.displays.push({ id: 2, workArea: { x: 1440, y: 25, width: 2560, height: 1390 } });
  f.state.window.setBounds({ x: 1600, y: 100, width: 1000, height: 800 });
  f.preferences.orbPosition = { x: 950, y: 740 };
  await f.enable();
  assert.deepEqual(f.orb().getPosition(), [3888, 1303], 'legacy coordinates cannot strand the orb');
  f.state.window.setPosition(100, 100);
  f.attention.reposition(f.state.window);
  assert.deepEqual(f.orb().getPosition(), [1328, 788]);
  f.attention.reposition(f.state.window);
  assert.deepEqual(f.orb().getPosition(), [1328, 788]);
});

test('display changes keep the default orb at the corner, including negative origins and unplugging', async () => {
  const f = fixture();
  await f.enable();
  assert.deepEqual(f.orb().getPosition(), [1328, 788]);
  f.displays[0].workArea = { x: 0, y: 25, width: 2560, height: 1390 };
  f.screen.emit('display-metrics-changed', {}, f.displays[0], ['workArea', 'scaleFactor']);
  assert.deepEqual(f.orb().getPosition(), [2448, 1303]);
  const external = { id: 2, workArea: { x: -1920, y: -1080, width: 1920, height: 1040 } };
  f.displays.push(external);
  f.state.window.setPosition(-1500, -800);
  f.screen.emit('display-added', {}, external);
  assert.deepEqual(f.orb().getPosition(), [-112, -152]);
  f.displays.pop();
  f.screen.emit('display-removed', {}, external);
  assert.deepEqual(f.orb().getPosition(), [2448, 1303], 'an unplugged screen cannot hide the orb');
});

test('manual placement survives reopening and resolution changes as offsets from the edges', async () => {
  const f = fixture();
  await f.enable();
  f.drag('start');
  f.drag('move', { x: -40, y: -60 });
  f.drag('end');
  assert.deepEqual(f.orb().getPosition(), [1288, 728]);
  f.attention.reposition(f.state.window);
  assert.deepEqual(
    f.orb().getPosition(),
    [1288, 728],
    'ordinary window activity preserves dragging',
  );
  await f.attention.setEnabled(false);
  await f.enable();
  assert.deepEqual(f.orb().getPosition(), [1288, 728]);
  f.displays[0].workArea = { x: 0, y: 25, width: 2560, height: 1390 };
  f.screen.emit('display-metrics-changed');
  assert.deepEqual(f.orb().getPosition(), [2408, 1243]);
  f.preferences.orbPosition.right = 5000;
  f.preferences.orbPosition.bottom = 5000;
  f.displays[0].workArea = { x: 0, y: 25, width: 1024, height: 700 };
  f.screen.emit('display-metrics-changed');
  assert.deepEqual(f.orb().getPosition(), [0, 25], 'saved offsets stay inside smaller work areas');
});

test('repositioning closes the hover card, cancels stale dragging and stops listening when disabled', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 4, 'Claude');
  f.card(true);
  assert.equal(f.orb().bounds.width, 354);
  f.displays[0].workArea = { x: 0, y: 25, width: 1920, height: 1000 };
  f.screen.emit('display-metrics-changed');
  assert.equal(f.orb().bounds.width, 88);
  assert.deepEqual(f.orb().getPosition(), [1808, 913]);
  f.card(false);
  assert.deepEqual(
    f.orb().getPosition(),
    [1808, 913],
    'a late hover event cannot restore the old position',
  );
  f.drag('start');
  f.displays[0].workArea = { x: 0, y: 25, width: 1440, height: 800 };
  f.screen.emit('display-metrics-changed');
  f.drag('move', { x: -400, y: -400 });
  f.drag('end');
  assert.deepEqual(f.orb().getPosition(), [1328, 713]);
  assert.equal(f.preferences.orbPosition, undefined);
  for (let count = 0; count < 3; count++) {
    await f.attention.setEnabled(false);
    assert.equal(f.screen.listenerCount('display-metrics-changed'), 0);
    await f.enable();
    assert.equal(f.screen.listenerCount('display-metrics-changed'), 1);
  }
});

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

test('a foreground terminal bell changes the orb quietly and can be acknowledged', async () => {
  const f = fixture();
  await f.enable();
  f.state.window.focus();
  f.attention.bell(f.state, f.first, 'Shell');
  assert.equal(f.status().status, 'attention');
  assert.equal(f.status().count, 0);
  assert.equal(f.sounds.length, 0);
  f.attention.acknowledge(f.state, f.first);
  assert.equal(f.status().status, 'idle');
});

test('a background bell after a quiet foreground alert becomes unread and sounds once', async () => {
  const f = fixture();
  await f.enable();
  f.state.window.focus();
  for (const native of [false, true]) {
    f.attention.clear(f.state, f.first);
    f.state.activeSession = f.first;
    if (native) {
      f.attention.program(f.state, f.first, { state: 'done', id: '' });
      f.attention.prompt(f.state, f.first);
    } else f.attention.bell(f.state, f.first, 'Shell');
    assert.equal(f.status().count, 0);
    const sounds = f.sounds.length;
    f.state.activeSession = f.second;
    f.advance(2000);
    f.attention.bell(f.state, f.first, 'Shell');
    assert.equal(f.status().count, 1);
    assert.equal(f.sounds.length, sounds + 1);
    f.attention.bell(f.state, f.first, 'Shell');
    assert.equal(f.sounds.length, sounds + 1, 'repeated unread bells stay grouped');
  }
});

test('native program states aggregate descendants and clear only the requested subtree', async () => {
  const f = fixture();
  await f.enable();
  const send = (state, id = '', kind) => f.attention.program(f.state, f.first, { state, id, kind });
  send('working');
  assert.equal(f.status().status, 'working');
  send('blocked', 'tools/edit', 'permission');
  assert.equal(f.status().reason, 'Approval requested');
  send('done', 'tools/build');
  assert.equal(f.status().reason, 'Approval requested');
  send('error', 'tools/edit/child');
  assert.equal(f.status().status, 'error');
  send('clear', 'tools/edit');
  assert.equal(f.status().reason, 'Response ready');
  send('blocked', 'tools/editor', 'question');
  send('clear', 'tools/edit');
  assert.equal(
    f.status().reason,
    'Question',
    'clearing a subtree preserves similarly named siblings',
  );
  send('blocked', 'tools/editor', 'auth');
  assert.equal(f.status().reason, 'Sign-in required');
  send('clear', 'tools');
  assert.equal(f.status().status, 'working');
  send('clear');
  assert.equal(f.status().status, 'idle');
  assert.equal(f.status().count, 0);
});

test('native reports own an episode while legacy progress and bells remain fallbacks', async () => {
  const f = fixture();
  await f.enable();
  f.attention.progress(f.state, f.first, 2, 'Old hook');
  f.attention.program(f.state, f.first, { state: 'working', id: '' });
  assert.equal(f.status().status, 'working', 'native state replaces a stale legacy error');
  f.attention.program(f.state, f.first, { state: 'blocked', id: '', kind: 'permission' });
  f.advance(2000);
  const sounds = f.sounds.length;
  for (const value of [0, 2, 3, 4]) f.attention.progress(f.state, f.first, value, 'Delayed hook');
  f.attention.interrupt(f.state, f.first);
  f.attention.bell(f.state, f.first, 'Delayed bell');
  assert.equal(f.status().reason, 'Approval requested');
  assert.equal(f.sounds.length, sounds);
  f.attention.program(f.state, f.first, { state: 'clear', id: '' });
  f.attention.progress(f.state, f.first, 4, 'Delayed hook');
  f.attention.bell(f.state, f.first, 'Delayed bell');
  assert.equal(f.status().status, 'idle', 'native clear retains ownership until the episode ends');
  assert.equal(f.attention.needsShellCheck(f.state, f.first), true);
  f.attention.reset(f.state, f.first);
  assert.equal(f.attention.needsShellCheck(f.state, f.first), false);
  f.attention.bell(f.state, f.first, 'Shell');
  assert.equal(f.status().status, 'attention');
  assert.equal(f.sounds.length, sounds + 1);
});

test('a cleared native permission request cannot leave its reason on an unrelated blocker', async () => {
  const f = fixture();
  await f.enable();
  f.attention.program(f.state, f.first, { state: 'blocked', id: 'permission', kind: 'permission' });
  f.attention.program(f.state, f.first, { state: 'blocked', id: 'other' });
  assert.equal(f.status().reason, 'Approval requested');
  const sounds = f.sounds.length;
  f.attention.program(f.state, f.first, { state: 'clear', id: 'permission' });
  assert.equal(f.status().reason, 'Needs attention');
  assert.equal(f.terminalEvents().at(-1).reason, 'Needs attention');
  assert.equal(f.sounds.length, sounds, 'changing the selected reason does not repeat a sound');
});

test('a blocked terminal takes priority over a completed response in another terminal', async () => {
  const f = fixture();
  await f.enable();
  f.attention.program(f.state, f.first, { state: 'done', id: '' });
  f.attention.program(f.state, f.second, { state: 'blocked', id: '', kind: 'question' });
  assert.equal(f.status().reason, 'Question');
  assert.equal(f.status().target, `${f.state.window.webContents.id}:${f.second}`);
  assert.equal(f.status().count, 2);
  f.open();
  assert.equal(
    f.state.window.messages.filter(({ channel }) => channel === 'terminal:focus').at(-1).value,
    f.second,
  );
  assert.equal(f.status().reason, 'Response ready');
  assert.equal(f.status().count, 1, 'the earlier finished response remains unread');
});

test('native records evict the least recently updated entry at capacity without starving new alerts', async () => {
  const f = fixture();
  await f.enable();
  for (let index = 0; index < 64; index++)
    f.attention.program(f.state, f.first, {
      state: index === 1 ? 'done' : 'working',
      id: `task/${index}`,
    });
  f.attention.program(f.state, f.first, { state: 'error', id: 'task/0' });
  assert.equal(f.status().status, 'error', 'an existing record can still change at capacity');
  f.attention.program(f.state, f.first, { state: 'blocked', id: 'overflow', kind: 'permission' });
  assert.equal(f.status().status, 'error', 'the recently updated error is retained');
  f.attention.program(f.state, f.first, { state: 'clear', id: 'task/0' });
  assert.equal(f.status().reason, 'Approval requested', 'the new blocker is accepted at capacity');
  f.attention.program(f.state, f.first, { state: 'clear', id: 'overflow' });
  assert.equal(f.status().status, 'working', 'the oldest completed record was evicted');
  f.attention.program(f.state, f.first, { state: 'clear', id: 'task' });
  f.attention.program(f.state, f.first, { state: 'blocked', id: 'new', kind: 'question' });
  assert.equal(f.status().reason, 'Question');
});

test('a confirmed shell expires live states, retains completion and restores ordinary bells', async () => {
  const f = fixture();
  await f.enable();
  for (const state of ['idle', 'working', 'blocked']) {
    f.attention.program(f.state, f.first, { state, id: '' });
    assert.equal(f.attention.needsShellCheck(f.state, f.first), true);
    f.attention.prompt(f.state, f.first);
    assert.equal(f.status().status, 'idle');
    assert.equal(f.attention.needsShellCheck(f.state, f.first), false);
  }
  f.attention.program(f.state, f.first, { state: 'blocked', id: '', kind: 'permission' });
  f.attention.program(f.state, f.first, { state: 'done', id: 'child' });
  f.attention.prompt(f.state, f.first);
  assert.equal(f.status().reason, 'Response ready', 'a finished child survives an expired blocker');
  assert.equal(f.attention.needsShellCheck(f.state, f.first), false);
  f.attention.acknowledge(f.state, f.first);
  f.advance(2000);
  const sounds = f.sounds.length;
  f.attention.bell(f.state, f.first, 'Shell');
  assert.equal(f.status().count, 1);
  assert.equal(f.sounds.length, sounds + 1);
  f.attention.clear(f.state, f.first);
  f.attention.progress(f.state, f.first, 3, 'Hook without SessionEnd');
  f.attention.prompt(f.state, f.first);
  assert.equal(f.status().status, 'idle', 'shell confirmation also clears stale legacy state');
});

test('PTY exit retains native completion and errors but clears unfinished and legacy states', async () => {
  const f = fixture();
  await f.enable();
  const session = f.state.sessions.get(f.first);
  for (const [native, expected] of [
    ['done', 'attention'],
    ['error', 'error'],
    ['working', 'idle'],
  ]) {
    session.process = {};
    f.attention.reset(f.state, f.first);
    f.attention.program(f.state, f.first, { state: native, id: '' });
    session.process = null;
    f.attention.finish(f.state, f.first);
    assert.equal(f.status().status, expected);
    assert.equal(f.terminalEvents().at(-1).status, expected);
    f.attention.program(f.state, f.first, { state: 'working', id: '' });
    assert.equal(f.status().status, expected, 'late reports cannot revive an exited PTY');
  }
  session.process = {};
  f.attention.progress(f.state, f.first, 2, 'Legacy');
  session.process = null;
  f.attention.finish(f.state, f.first);
  assert.equal(f.status().status, 'idle');
});

test('native notifications use each tab’s project and route identical terminal IDs across windows', async () => {
  const f = fixture();
  f.state.sessions.get(f.first).checkoutRoot = '/projects/current-project';
  f.attention.program(f.state, f.first, { state: 'done', id: '' });
  assert.equal(f.notifications[0].body, 'current-project · Terminal');
  await f.enable();
  assert.equal(f.status().project, 'current-project');
  const other = f.addWindow();
  other.sessions.set(f.first, {
    process: {},
    label: 'Review',
    checkoutRoot: '/projects/second-project',
  });
  f.attention.program(other, f.first, { state: 'error', id: '' });
  assert.equal(f.status().project, 'second-project');
  assert.equal(f.status().label, 'second-project · Review');
  assert.equal(f.status().count, 2);
  const target = f.status().target;
  f.open(undefined, target);
  assert.equal(other.window.isFocused(), true);
  assert.equal(f.state.window.isFocused(), false);
  assert.equal(f.status().count, 1);
  assert.equal(f.status().project, 'current-project');
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
  f.attention.progress(f.state, f.first, 4, 'Visible', 'question');
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
