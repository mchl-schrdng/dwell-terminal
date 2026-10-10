import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { $, node, icon, refreshIcons } from './ui.js';
import { renderCode, renderMarkdown, renderDiff } from './preview.js';

const api = window.dwell;
let project;
let settings;
let selected = null;
let expanded = new Set();
let treeVersion = 0;
let previewVersion = 0;
let lastPreview;
let markdownSource = false;
let saveTimer;
let activeSession;
let terminalCounter = 0;
let changesBusy = false;
const sessions = new Map();
const workspace = $('#workspace');
const fileDragType = 'application/x-dwell-file';

function message(text) {
  $('#status-message').textContent = text;
}
function report(error) {
  message(error.message || String(error));
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      api
        .save({
          ...settings,
          expanded: [...expanded],
          selected,
          terminalNames: [...sessions.values()].map((session) => session.label),
        })
        .catch(report),
    180,
  );
}

function layout() {
  if (!settings) return;
  const width = window.innerWidth;
  const showPreview = settings.showPreview;
  const showTree = settings.showTree && !(showPreview && width < 960);
  const treeWidth = Math.min(
    settings.treeWidth,
    550,
    Math.max(180, width - 462 - (showPreview ? 300 : 0)),
  );
  const previewWidth = Math.min(
    settings.previewWidth,
    900,
    Math.max(300, width - 462 - (showTree ? treeWidth : 0)),
  );
  document.documentElement.style.setProperty('--tree-width', treeWidth + 'px');
  document.documentElement.style.setProperty('--preview-width', previewWidth + 'px');
  $('#tree-pane').hidden = $('#tree-divider').hidden = !showTree;
  $('#preview-pane').hidden = $('#preview-divider').hidden = !showPreview;
  workspace.classList.toggle('no-tree', !showTree);
  workspace.classList.toggle('no-preview', !showPreview);
  $('#toggle-tree').setAttribute('aria-pressed', String(showTree));
  $('#toggle-preview').setAttribute('aria-pressed', String(showPreview));
  $('#file-status').hidden = !showPreview;
  $('#tree-divider').setAttribute('aria-valuenow', String(Math.round(treeWidth)));
  $('#preview-divider').setAttribute('aria-valuenow', String(Math.round(previewWidth)));
  const changes = settings.treeMode === 'changes';
  $('#show-files').setAttribute('aria-pressed', String(!changes));
  $('#show-changes').setAttribute('aria-pressed', String(changes));
  $('#toggle-hidden').hidden = changes;
  $('#refresh-changes').hidden = !changes;
  $('#tree').setAttribute('aria-label', changes ? 'Changed files' : 'Project files');
  requestAnimationFrame(() => activeSession?.fit.fit());
}

function togglePane(which) {
  const key = which === 'tree' ? 'showTree' : 'showPreview';
  settings[key] = !settings[key];
  if (which === 'tree' && settings.showTree && window.innerWidth < 960)
    settings.showPreview = false;
  layout();
  save();
  activeSession?.terminal.focus();
}

function watch() {
  const parent = selected?.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '.';
  api.watch(['.', ...expanded, parent]).catch(report);
}

async function refreshTree() {
  if (!project?.root) return;
  const version = ++treeVersion;
  if (settings.treeMode === 'changes') return refreshChanges(version);
  const fragment = document.createDocumentFragment();
  const focused = document.activeElement?.dataset.path;
  async function walk(relative, depth) {
    if (depth > 64) return;
    let entries;
    try {
      entries = await api.list(relative, settings.hidden);
    } catch (error) {
      fragment.append(node('div', 'tree-error', error.message));
      return;
    }
    if (version !== treeVersion) return;
    for (const entry of entries) {
      const row = node('button', 'tree-row');
      row.type = 'button';
      row.dataset.path = entry.path;
      row.dataset.directory = String(entry.directory);
      row.style.setProperty('--depth', depth);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      row.setAttribute('aria-selected', String(entry.path === selected));
      row.tabIndex = entry.path === (focused || selected) ? 0 : -1;
      row.title = entry.path + (entry.link ? ' (symbolic link)' : '');
      if (!entry.directory) makeDraggable(row, entry.path);
      if (entry.directory) {
        row.setAttribute('aria-expanded', String(expanded.has(entry.path)));
        const chevron = icon(expanded.has(entry.path) ? 'chevron-down' : 'chevron-right');
        chevron.className = 'chevron';
        row.append(chevron);
      } else row.append(node('span', 'spacer'));
      row.append(
        icon(
          entry.directory
            ? 'folder'
            : /\.(png|jpe?g|webp)$/i.test(entry.name)
              ? 'image'
              : /\.(md|txt)$/i.test(entry.name)
                ? 'file-text'
                : 'file-code-2',
        ),
        node('span', 'file-name', entry.name),
      );
      if (entry.link) {
        const link = icon('link');
        link.className = 'link-mark';
        row.append(link);
      }
      row.addEventListener('click', async (event) => {
        if (event.detail > 0) activeSession?.terminal.focus();
        if (entry.directory) {
          if (expanded.has(entry.path)) expanded.delete(entry.path);
          else expanded.add(entry.path);
          await refreshTree();
          watch();
          save();
        } else await selectFile(entry.path);
      });
      fragment.append(row);
      if (entry.directory && expanded.has(entry.path)) await walk(entry.path, depth + 1);
    }
  }
  await walk('.', 0);
  if (version !== treeVersion) return;
  if (!fragment.children.length)
    fragment.append(node('div', 'tree-error', 'This folder is empty.'));
  const restoreFocus = focused && document.activeElement?.dataset.path === focused;
  const scroll = $('#tree').scrollTop;
  $('#tree').replaceChildren(fragment);
  $('#tree').scrollTop = scroll;
  const rows = [...$('#tree').querySelectorAll('.tree-row')];
  if (!rows.some((row) => row.tabIndex === 0) && rows[0]) rows[0].tabIndex = 0;
  if (restoreFocus)
    rows.find((row) => row.dataset.path === focused)?.focus({ preventScroll: true });
  refreshIcons();
}

function makeDraggable(row, relative) {
  row.draggable = true;
  row.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(fileDragType, relative);
  });
}

async function refreshChanges(version) {
  const tree = $('#tree');
  try {
    const result = await api.changes();
    if (version !== treeVersion) return;
    const focused = document.activeElement?.dataset.path;
    const scroll = tree.scrollTop;
    const fragment = document.createDocumentFragment();
    for (const entry of result.entries) {
      const row = node('button', 'tree-row change-row');
      row.type = 'button';
      row.dataset.path = entry.path;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', '1');
      row.setAttribute('aria-selected', String(entry.path === selected));
      row.tabIndex = entry.path === (focused || selected) ? 0 : -1;
      const status =
        entry.status === '??'
          ? 'New'
          : entry.status.includes('U') || ['AA', 'DD'].includes(entry.status)
            ? 'Conflict'
            : entry.status.includes('D')
              ? 'Deleted'
              : entry.status.includes('A')
                ? 'Added'
                : 'Modified';
      row.title = `${entry.path} · ${status}`;
      row.append(
        icon('file-code-2'),
        node('span', 'file-name', entry.path),
        node('span', 'change-status', status),
      );
      if (!entry.status.includes('D')) makeDraggable(row, entry.path);
      row.addEventListener('click', () => {
        selectFile(entry.path).catch(report);
        activeSession?.terminal.focus();
      });
      fragment.append(row);
    }
    if (!result.entries.length)
      fragment.append(
        node(
          'div',
          'tree-error',
          result.repository
            ? 'No changes. Working tree is clean.'
            : 'This folder is not in a Git repository.',
        ),
      );
    if (result.truncated)
      fragment.append(node('div', 'tree-error', 'Showing the first 1,000 changed files.'));
    tree.replaceChildren(fragment);
    tree.scrollTop = scroll;
    const rows = [...tree.querySelectorAll('.tree-row')];
    if (!rows.some((row) => row.tabIndex === 0) && rows[0]) rows[0].tabIndex = 0;
    if (focused) rows.find((row) => row.dataset.path === focused)?.focus({ preventScroll: true });
    refreshIcons();
  } catch (error) {
    if (version === treeVersion) tree.replaceChildren(node('div', 'tree-error', error.message));
  }
}

async function refreshGit() {
  if (changesBusy) return;
  changesBusy = true;
  try {
    await refreshTree();
    await loadPreview();
  } finally {
    changesBusy = false;
  }
}

setInterval(() => {
  if (
    settings?.treeMode === 'changes' &&
    document.visibilityState === 'visible' &&
    (!$('#tree-pane').hidden || !$('#preview-pane').hidden)
  )
    refreshGit().catch(report);
}, 2500);

$('#tree').addEventListener('keydown', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  const rows = [...$('#tree').querySelectorAll('.tree-row')];
  const index = rows.indexOf(row);
  let target;
  if (event.key === 'ArrowDown') target = rows[Math.min(rows.length - 1, index + 1)];
  if (event.key === 'ArrowUp') target = rows[Math.max(0, index - 1)];
  if (event.key === 'Home') target = rows[0];
  if (event.key === 'End') target = rows[rows.length - 1];
  if (event.key === 'ArrowRight' && row.dataset.directory === 'true') {
    if (!expanded.has(row.dataset.path)) row.click();
    else target = rows[index + 1];
  }
  if (event.key === 'ArrowLeft') {
    if (expanded.has(row.dataset.path)) row.click();
    else {
      const parent = row.dataset.path.split('/').slice(0, -1).join('/');
      target = rows.find((item) => item.dataset.path === parent);
    }
  }
  if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
    event.preventDefault();
  if (target) {
    rows.forEach((item) => {
      item.tabIndex = item === target ? 0 : -1;
    });
    target.focus();
  }
});

async function selectFile(relative) {
  const changed = selected !== relative;
  selected = relative;
  if (changed) {
    markdownSource = false;
    lastPreview = null;
    $('#preview-content').scrollTop = 0;
  }
  settings.showPreview = true;
  layout();
  $('#tree')
    .querySelectorAll('.tree-row')
    .forEach((row) => row.setAttribute('aria-selected', String(row.dataset.path === selected)));
  if (changed)
    $('#preview-content').replaceChildren(node('div', 'empty-state', 'Loading preview…'));
  watch();
  save();
  await loadPreview();
}

function emptyPreview(text, actions = false) {
  const container = node('div', 'empty-state');
  container.append(icon('file-search'), node('p', '', text));
  if (actions) {
    const buttons = node('div', 'actions');
    const open = node('button', 'text-button', 'Open in Default App');
    open.addEventListener('click', () => api.openFile(selected).catch(report));
    const reveal = node('button', 'text-button', 'Show in Finder');
    reveal.addEventListener('click', () => api.reveal(selected).catch(report));
    buttons.append(open, reveal);
    container.append(buttons);
  }
  $('#preview-content').replaceChildren(container);
  refreshIcons();
}

function displayPreview(file) {
  const content = $('#preview-content');
  const scroll = content.scrollTop;
  $('#toggle-source').hidden = file.kind !== 'markdown';
  $('#toggle-source').setAttribute('aria-pressed', String(markdownSource));
  $('#toggle-source').title = markdownSource ? 'View rendered Markdown' : 'View Markdown source';
  $('#toggle-source').setAttribute('aria-label', $('#toggle-source').title);
  $('#toggle-wrap').hidden =
    !['text', 'markdown'].includes(file.kind) || (file.kind === 'markdown' && !markdownSource);
  $('#toggle-wrap').setAttribute('aria-pressed', String(settings.wrap));
  $('#preview-note').hidden = !file.truncated;
  $('#preview-note').textContent = file.truncated
    ? 'Preview limited to the first 1 MiB and 2,000 lines.'
    : '';
  if (file.kind === 'diff') content.replaceChildren(renderDiff(file));
  else if (file.kind === 'text' || (file.kind === 'markdown' && markdownSource))
    content.replaceChildren(renderCode(file.text, file.ext, settings.wrap));
  else if (file.kind === 'markdown') {
    const markdown = renderMarkdown(file.text, (url) => api.openLink(url).catch(report));
    content.replaceChildren(markdown);
  } else if (file.kind === 'image') {
    const container = node('div', 'image-preview');
    const image = node('img');
    image.src = file.data;
    image.alt = selected.split('/').pop();
    container.append(
      image,
      node('p', '', `${file.width} × ${file.height} · ${formatSize(file.size)}`),
    );
    content.replaceChildren(container);
  } else emptyPreview(file.reason, true);
  $('#file-status').textContent =
    file.kind === 'diff'
      ? 'Git diff · Read-only'
      : `${file.kind === 'markdown' ? 'Markdown' : file.kind === 'image' ? 'Image' : file.ext?.slice(1).toUpperCase() || 'File'} · ${formatSize(file.size)} · Read-only`;
  content.scrollTop = scroll;
}
function formatSize(size) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
async function loadPreview() {
  if (!selected) return;
  $('#preview-name').textContent = selected.split('/').pop();
  $('#preview-name').title = selected;
  $('#preview-path').textContent = selected.split('/').join(' / ');
  const version = ++previewVersion;
  try {
    const file =
      settings.treeMode === 'changes'
        ? { ...(await api.diff(selected)), kind: 'diff' }
        : await api.preview(selected);
    if (version !== previewVersion) return;
    if (lastPreview && JSON.stringify(file) === JSON.stringify(lastPreview)) return;
    lastPreview = file;
    displayPreview(file);
  } catch (error) {
    if (version !== previewVersion) return;
    lastPreview = null;
    $('#preview-note').hidden = true;
    $('#toggle-source').hidden = true;
    $('#toggle-wrap').hidden = true;
    $('#file-status').textContent = 'Read-only';
    emptyPreview(error.message);
  }
}

function updateTerminalControls() {
  const terminal = activeSession?.terminal;
  $('#terminal-empty').hidden = sessions.size > 0;
  $('#restart-terminal').hidden = !activeSession || activeSession.starting || activeSession.running;
  $('#scroll-bottom').hidden =
    !terminal || terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
}

function activateSession(session, focus = true) {
  activeSession = session;
  for (const item of sessions.values()) {
    const active = item === session;
    item.pane.hidden = !active;
    item.tabItem.classList.toggle('active', active);
    item.tab.setAttribute('aria-selected', String(active));
    item.tab.tabIndex = active ? 0 : -1;
  }
  session?.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateTerminalControls();
  if (focus) session?.terminal.focus();
  if (session) api.active(session.id);
  requestAnimationFrame(() => {
    if (session && activeSession === session) session.fit.fit();
  });
}

function renameTerminal(session) {
  if (session.tabItem.querySelector('input')) return;
  const input = node('input', 'terminal-tab-name');
  input.type = 'text';
  input.maxLength = 80;
  input.value = session.label;
  input.setAttribute('aria-label', 'Terminal name');
  session.tab.hidden = true;
  session.tab.before(input);
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    const label = input.value.trim();
    if (commit && label) {
      session.label = label;
      session.tab.querySelector('span').textContent = label;
      session.tab.title = `${label} · Double-click to rename`;
      session.closeButton.title = `Close ${label}`;
      session.closeButton.setAttribute('aria-label', `Close ${label}`);
      save();
    }
    session.tab.hidden = false;
    input.remove();
    if (activeSession === session) session.terminal.focus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(event.key === 'Enter');
  });
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
}

async function createTerminal(savedLabel) {
  if (!project?.root) return;
  if (sessions.size >= 32) {
    message('Up to 32 terminals can be open in one window.');
    return;
  }
  const id = crypto.randomUUID();
  const label = savedLabel || `Terminal ${terminalCounter + 1}`;
  terminalCounter++;
  const pane = node('div', 'terminal-session');
  pane.id = `session-${id}`;
  pane.setAttribute('role', 'tabpanel');
  const tabItem = node('div', 'terminal-tab-item');
  const tab = node('button', 'terminal-tab');
  tab.id = `tab-${id}`;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', pane.id);
  pane.setAttribute('aria-labelledby', tab.id);
  tab.append(icon('terminal'), node('span', '', label));
  const closeButton = node('button', 'icon-button tab-close');
  closeButton.setAttribute('aria-label', `Close ${label}`);
  closeButton.title = `Close ${label}`;
  closeButton.append(icon('x'));
  tabItem.append(tab, closeButton);
  $('#terminal-tabs').append(tabItem);
  $('#terminal').append(pane);
  const term = new Terminal({
    fontFamily: '"SF Mono", SFMono-Regular, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.18,
    cursorBlink: false,
    cursorStyle: 'bar',
    scrollback: 10000,
    macOptionIsMeta: true,
    allowProposedApi: false,
    allowTransparency: true,
    theme: {
      background: '#00000000',
      foreground: '#e5e5e7',
      cursor: '#c3c5cc',
      selectionBackground: '#454950',
      black: '#292b30',
      brightBlack: '#83868f',
      red: '#df9393',
      brightRed: '#f1a4a4',
      green: '#a9c4a4',
      brightGreen: '#bdd7b8',
      yellow: '#d0bd98',
      brightYellow: '#e1cea9',
      blue: '#a6bdd9',
      brightBlue: '#bdd2ea',
      magenta: '#c4afd3',
      brightMagenta: '#d7c2e4',
      cyan: '#9ebfc1',
      brightCyan: '#b2d2d4',
      white: '#d4d5da',
      brightWhite: '#f0f0f2',
    },
  });
  const fit = new FitAddon();
  const session = {
    id,
    terminal: term,
    fit,
    pane,
    tab,
    tabItem,
    label,
    closeButton,
    starting: true,
    running: false,
    exited: false,
    closing: false,
  };
  sessions.set(id, session);
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, url) => api.openLink(url).catch(report)));
  term.open(pane);
  term.onData((data) => api.input(id, data));
  term.onKey(({ domEvent }) => {
    if (domEvent.key === 'Enter') api.active(id);
  });
  term.onBell(() => api.bell(id, session.label));
  term.parser.registerOscHandler(9, (data) => {
    if (!/^4;[0-4](?:;(?:100|[0-9]{1,2}))?$/.test(data)) return false;
    api.progress(id, Number(data[2]), session.label);
    return true;
  });
  term.onResize(({ cols, rows }) => {
    if (session.running) api.resize(id, cols, rows);
  });
  term.onScroll(() => {
    if (activeSession === session) updateTerminalControls();
  });
  term.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase();
    if (!event.metaKey || !['c', 'v'].includes(key)) return true;
    if (event.type === 'keydown') {
      event.preventDefault();
      action(key === 'c' ? 'copy' : 'paste').catch(report);
    }
    return false;
  });
  tab.addEventListener('click', () => activateSession(session));
  tab.addEventListener('dblclick', () => renameTerminal(session));
  tab.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
      event.preventDefault();
      renameTerminal(session);
    }
  });
  closeButton.addEventListener('click', () => closeSession(session).catch(report));
  refreshIcons();
  activateSession(session);
  fit.fit();
  session.ready = api
    .start(id, term.cols, term.rows)
    .then((result) => {
      session.running = !session.exited;
      tab.title = `${session.label} · ${result?.shell || 'shell'} · Double-click to rename`;
      // A pane may have been resized while its shell was starting.
      if (session.running) api.resize(id, term.cols, term.rows);
    })
    .catch((error) => {
      term.writeln(`\r\nCould not start the shell: ${error.message}`);
    })
    .finally(() => {
      session.starting = false;
      if (activeSession === session) updateTerminalControls();
    });
  await session.ready;
  save();
  return session;
}

async function closeSession(session) {
  if (!session || session.closing) return;
  session.closing = true;
  try {
    await session.ready;
    if (!(await api.closeTerminal(session.id))) {
      if (activeSession === session) session.terminal.focus();
      return;
    }
    const items = [...sessions.values()];
    const index = items.indexOf(session);
    sessions.delete(session.id);
    session.terminal.dispose();
    session.pane.remove();
    session.tabItem.remove();
    if (activeSession === session) activateSession(items[index + 1] || items[index - 1]);
    else {
      updateTerminalControls();
      activeSession?.terminal.focus();
    }
    if (!sessions.size) $('#empty-new-terminal').focus();
    save();
  } finally {
    session.closing = false;
  }
}

function cycleTerminal(offset, focus = true) {
  const items = [...sessions.values()];
  if (!items.length) return;
  activateSession(
    items[(items.indexOf(activeSession) + offset + items.length) % items.length],
    focus,
  );
}

api.onData(({ id, data }) => {
  const session = sessions.get(id);
  if (session) session.terminal.write(data, () => api.ack(id, data.length));
});
api.onAttention(({ id, pending, status }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.tabItem.classList.toggle('needs-attention', pending);
  if (pending)
    session.tab.setAttribute(
      'aria-description',
      status === 'error' ? 'Response interrupted' : 'Terminal needs attention',
    );
  else session.tab.removeAttribute('aria-description');
});
api.onFocusTerminal((id) => {
  const session = sessions.get(id);
  if (session) activateSession(session);
});
window.addEventListener('focus', () => {
  if (activeSession) api.active(activeSession.id);
  if (settings?.treeMode === 'changes') refreshGit().catch(report);
});
api.onExit(({ id, exitCode }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.running = false;
  session.exited = true;
  session.tabItem.classList.add('ended');
  session.tab.title = `Session ended (${exitCode})`;
  session.terminal.writeln(`\r\n\x1b[90mSession ended (${exitCode}).\x1b[0m`);
  if (activeSession === session) updateTerminalControls();
});
new ResizeObserver(() => requestAnimationFrame(() => activeSession?.fit.fit())).observe(
  $('#terminal'),
);
$('#terminal-tabs').addEventListener('keydown', (event) => {
  if (!event.target.matches('[role="tab"]')) return;
  if (event.key === 'ArrowRight') cycleTerminal(1, false);
  else if (event.key === 'ArrowLeft') cycleTerminal(-1, false);
  else if (event.key === 'Home') activateSession([...sessions.values()][0], false);
  else if (event.key === 'End') activateSession([...sessions.values()].at(-1), false);
  else return;
  event.preventDefault();
  activeSession?.tab.focus();
});

async function openProject(value) {
  project = value;
  $('#project-name').textContent = value.name;
  $('#project-button').title = value.root ? `${value.root} · Open Folder (⌘O)` : 'Open Folder · ⌘O';
  if (!value.root) return;
  $('#welcome').hidden = true;
  workspace.hidden = false;
  $('#project-path').textContent = value.root.startsWith(value.home + '/')
    ? '~' + value.root.slice(value.home.length)
    : value.root;
  $('#project-path').title = value.root;
  settings = {
    treeMode: 'files',
    treeWidth: window.innerWidth * 0.19,
    previewWidth: window.innerWidth * 0.32,
    showTree: true,
    showPreview: window.innerWidth >= 1120,
    hidden: false,
    wrap: true,
    ...value.settings,
  };
  expanded = new Set(settings.expanded || []);
  selected = settings.selected || null;
  $('#toggle-hidden').setAttribute('aria-pressed', String(settings.hidden));
  layout();
  if (!sessions.size) {
    const names = settings.terminalNames?.length ? settings.terminalNames : [null];
    for (const name of names) await createTerminal(name);
  }
  await refreshTree();
  watch();
  await loadPreview();
  message('');
}

async function action(name) {
  const nameInput = document.activeElement?.matches('.terminal-tab-name')
    ? document.activeElement
    : null;
  if (name === 'copy') {
    const text = nameInput
      ? nameInput.value.slice(nameInput.selectionStart, nameInput.selectionEnd)
      : window.getSelection()?.toString() || activeSession?.terminal.getSelection();
    if (text) await api.copy(text);
    return;
  }
  if (name === 'paste') {
    if (nameInput) {
      const text = await api.paste();
      if (nameInput.isConnected) {
        const available =
          nameInput.maxLength -
          nameInput.value.length +
          nameInput.selectionEnd -
          nameInput.selectionStart;
        nameInput.setRangeText(
          text.replace(/[\r\n]/g, ' ').slice(0, available),
          nameInput.selectionStart,
          nameInput.selectionEnd,
          'end',
        );
      }
      return;
    }
    const target = activeSession;
    if (target) {
      target.terminal.focus();
      const text = await api.paste();
      if (sessions.has(target.id)) target.terminal.paste(text);
    }
    return;
  }
  if (!settings) return;
  if (name === 'tree' || name === 'preview') togglePane(name);
  if (name === 'terminal') activeSession?.terminal.focus();
  if (name === 'new-terminal') await createTerminal();
  if (name === 'close-terminal') await closeSession(activeSession);
  if (name === 'next-terminal') cycleTerminal(1);
  if (name === 'previous-terminal') cycleTerminal(-1);
  if (name === 'hidden') {
    settings.hidden = !settings.hidden;
    $('#toggle-hidden').setAttribute('aria-pressed', String(settings.hidden));
    await refreshTree();
    save();
  }
}
$('#project-button').addEventListener('click', () => api.chooseFolder().catch(report));
$('#open-folder').addEventListener('click', () => api.chooseFolder().catch(report));
$('#toggle-tree').addEventListener('click', () => action('tree'));
$('#toggle-preview').addEventListener('click', () => action('preview'));
$('#close-preview').addEventListener('click', () => action('preview'));
$('#toggle-hidden').addEventListener('click', () => action('hidden'));
for (const mode of ['files', 'changes']) {
  $(`#show-${mode}`).addEventListener('click', async () => {
    settings.treeMode = mode;
    lastPreview = null;
    $('#preview-content').scrollTop = 0;
    layout();
    save();
    await refreshTree().catch(report);
    await loadPreview();
    activeSession?.terminal.focus();
  });
}
$('#refresh-changes').addEventListener('click', () => refreshGit().catch(report));
$('#new-terminal').addEventListener('click', () => createTerminal().catch(report));
$('#empty-new-terminal').addEventListener('click', () => createTerminal().catch(report));
$('#restart-terminal').addEventListener('click', async () => {
  const previous = activeSession;
  if (!previous || previous.starting || previous.running) return;
  try {
    await closeSession(previous);
    await createTerminal();
  } catch (error) {
    report(error);
  }
});
$('#scroll-bottom').addEventListener('click', () => {
  activeSession?.terminal.scrollToBottom();
  activeSession?.terminal.focus();
});
$('#toggle-source').addEventListener('click', () => {
  markdownSource = !markdownSource;
  if (lastPreview) displayPreview(lastPreview);
});
$('#toggle-wrap').addEventListener('click', () => {
  settings.wrap = !settings.wrap;
  if (lastPreview) displayPreview(lastPreview);
  save();
});
for (const [selector, key, direction] of [
  ['#tree-divider', 'treeWidth', 1],
  ['#preview-divider', 'previewWidth', -1],
]) {
  const divider = $(selector);
  const resize = (width) => {
    settings[key] = Math.max(
      Number(divider.getAttribute('aria-valuemin')),
      Math.min(Number(divider.getAttribute('aria-valuemax')), width),
    );
    layout();
  };
  divider.addEventListener('pointerdown', (event) => {
    const start = event.clientX;
    const width = $(key === 'treeWidth' ? '#tree-pane' : '#preview-pane').getBoundingClientRect()
      .width;
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    const move = (e) => resize(width + (e.clientX - start) * direction);
    const up = () => {
      divider.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing');
      save();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('lostpointercapture', up, { once: true });
  });
  divider.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      resize(settings[key] + (event.key === 'ArrowRight' ? 15 : -15) * direction);
      save();
    }
  });
}
window.addEventListener('resize', layout);
const acceptsFiles = (event) =>
  [...event.dataTransfer.types].some((type) => type === 'Files' || type === fileDragType);
window.addEventListener('dragover', (event) => {
  if (acceptsFiles(event)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (acceptsFiles(event)) event.preventDefault();
});
$('#terminal').addEventListener(
  'dragover',
  (event) => {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = activeSession?.running ? 'copy' : 'none';
    $('#terminal').classList.toggle('file-drop', Boolean(activeSession?.running));
  },
  true,
);
$('#terminal').addEventListener('dragleave', (event) => {
  if (!$('#terminal').contains(event.relatedTarget)) $('#terminal').classList.remove('file-drop');
});
window.addEventListener('dragend', () => $('#terminal').classList.remove('file-drop'));
$('#terminal').addEventListener(
  'drop',
  async (event) => {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    $('#terminal').classList.remove('file-drop');
    const target = activeSession;
    if (!target?.running) return;
    const relative = event.dataTransfer.getData(fileDragType);
    const files = [...event.dataTransfer.files];
    try {
      const text = relative ? await api.reference(relative) : await api.droppedFiles(files);
      if (!sessions.has(target.id) || !target.running) return;
      target.terminal.paste(text);
      if (target === activeSession) target.terminal.focus();
    } catch (error) {
      report(error);
    }
  },
  true,
);
api.onMenu((name) => action(name).catch(report));
api.onFiles(() => {
  refreshTree().then(watch).catch(report);
  loadPreview();
});
api.onProject((value) => openProject(value).catch(report));
refreshIcons();
api.project().then(openProject).catch(report);
