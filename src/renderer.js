import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { $, node, icon, refreshIcons } from './ui.js';
import { renderCode, renderMarkdown, renderDiff } from './preview.js';
import { references } from './references.cjs';

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
let focusMode = false;
const sessions = new Map();
const navigation = new Map();
let visibleRoot;
let restoring = false;
const scope = (session = activeSession) => ({
  id: session?.id,
  revision: session?.context?.revision,
});
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
          tabs: [...sessions.values()].map((session) => ({ id: session.id, label: session.label })),
        })
        .catch(report),
    180,
  );
}

function layout() {
  if (!settings) return;
  const width = window.innerWidth;
  const showPreview = settings.showPreview && !focusMode;
  const showTree = settings.showTree && !focusMode && !(showPreview && width < 960);
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
  $('#toggle-focus').setAttribute('aria-pressed', String(focusMode));
  $('#file-status').hidden = !showPreview;
  $('#tree-divider').setAttribute('aria-valuenow', String(Math.round(treeWidth)));
  $('#preview-divider').setAttribute('aria-valuenow', String(Math.round(previewWidth)));
  const changes = settings.treeMode === 'changes';
  $('#show-files').setAttribute('aria-pressed', String(!changes));
  $('#show-changes').setAttribute('aria-pressed', String(changes));
  $('#toggle-hidden').hidden = changes;
  $('#refresh-changes').hidden = !changes;
  $('#tree').setAttribute('aria-label', changes ? 'Changed files' : 'Project files');
  requestAnimationFrame(fitActiveTerminal);
}

function togglePane(which) {
  const key = which === 'tree' ? 'showTree' : 'showPreview';
  settings[key] = focusMode || !settings[key];
  focusMode = false;
  if (which === 'tree' && settings.showTree && window.innerWidth < 960)
    settings.showPreview = false;
  layout();
  save();
  activeSession?.terminal.focus();
}

function fitActiveTerminal() {
  if (!activeSession) return;
  if (activeSession.terminal.options.fontSize !== settings.terminalFontSize)
    activeSession.terminal.options.fontSize = settings.terminalFontSize;
  activeSession.fit.fit();
}

function zoomTerminal(delta) {
  settings.terminalFontSize = Math.max(
    11,
    Math.min(24, delta === 0 ? 14 : settings.terminalFontSize + delta),
  );
  fitActiveTerminal();
  save();
}

function watch() {
  if (!activeSession?.context || activeSession.context.status !== 'ready') return;
  const parent = selected?.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '.';
  api.watch(scope(), ['.', ...expanded, parent]).catch(report);
}

async function refreshTree() {
  if (!activeSession?.context || activeSession.context.status !== 'ready') return;
  const context = scope();
  const version = ++treeVersion;
  if (settings.treeMode === 'changes') return refreshChanges(version);
  const fragment = document.createDocumentFragment();
  const focused = document.activeElement?.dataset.path;
  async function walk(relative, depth) {
    if (depth > 64) return;
    let entries;
    try {
      entries = await api.list(context, relative, settings.hidden);
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
    event.dataTransfer.setData(fileDragType, JSON.stringify({ ...scope(), relative }));
  });
}

async function refreshChanges(version) {
  const tree = $('#tree');
  try {
    const result = await api.changes(scope());
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
  focusMode = false;
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
    open.addEventListener('click', () => api.openFile(scope(), selected).catch(report));
    const reveal = node('button', 'text-button', 'Show in Finder');
    reveal.addEventListener('click', () => api.reveal(scope(), selected).catch(report));
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
  if (!selected || !activeSession?.context || activeSession.context.status !== 'ready') return;
  $('#preview-name').textContent = selected.split('/').pop();
  $('#preview-name').title = selected;
  $('#preview-path').textContent = selected.split('/').join(' / ');
  const version = ++previewVersion;
  try {
    const file =
      settings.treeMode === 'changes'
        ? { ...(await api.diff(scope(), selected)), kind: 'diff' }
        : await api.preview(scope(), selected);
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
  $('#restart-terminal').hidden =
    !activeSession || activeSession.starting || activeSession.running || activeSession.restored;
  $('#scroll-bottom').hidden =
    !terminal || terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
  const state = sessionState(activeSession);
  const reason = activeSession ? state.reason : '';
  if ($('#session-status').textContent !== reason) $('#session-status').textContent = reason;
  $('#session-status').dataset.status = state.status;
  const pending = nextAttention();
  $('#next-attention').hidden = !pending;
  if (pending) {
    $('#next-attention').textContent = `${pending.label} · ${pending.attention.reason}`;
    $('#next-attention').dataset.status = pending.attention.status;
    $('#next-attention').title = 'Next session needing attention · ⌘⌥A';
  }
}

function sessionState(session) {
  if (session?.attention?.status && session.attention.status !== 'idle') return session.attention;
  return {
    status: session?.error ? 'error' : 'idle',
    reason: session?.error
      ? 'Could not start session'
      : session?.starting
        ? 'Starting…'
        : session?.exited
          ? 'Session ended'
          : session?.restored
            ? 'Saved session'
            : 'Terminal',
  };
}

function updateSession(session) {
  const state = sessionState(session);
  session.tabItem.dataset.status = state.status;
  session.tabItem.classList.toggle('needs-attention', session.attention?.pending === true);
  session.tab.setAttribute(
    'aria-description',
    `${session.attention?.pending ? 'Unread · ' : ''}${state.reason}`,
  );
  session.tab.title = [
    session.label,
    session.context?.branch,
    state.reason,
    'Double-click to rename',
  ]
    .filter(Boolean)
    .join(' · ');
  updateTerminalControls();
  if ($('#session-dialog').open) renderSessions();
}

function nextAttention() {
  const pending = [...sessions.values()].filter((session) => session.attention?.pending);
  return pending.find((session) => session.attention.status === 'error') || pending[0];
}

function renderSessions() {
  const search = $('#session-search').value.trim().toLowerCase();
  const focused = document.activeElement?.dataset.session;
  const list = $('#session-list');
  const existing = new Map([...list.children].map((button) => [button.dataset.session, button]));
  const rows = [...sessions.values()].flatMap((session) => {
    const context = session.context;
    const detail = context?.branch || (context?.checkoutRoot || project.root).split('/').pop();
    if (![session.label, detail, context?.checkoutRoot].join(' ').toLowerCase().includes(search))
      return [];
    const state = sessionState(session);
    let button = existing.get(session.id);
    if (!button) {
      button = node('button', 'session-choice');
      button.type = 'button';
      button.dataset.session = session.id;
      button.append(
        node('span', 'session-choice-name'),
        node('span', 'session-choice-detail'),
        node('span', 'session-choice-status'),
      );
      button.addEventListener('click', () => {
        $('#session-dialog').close();
        activateSession(session);
      });
    }
    button.dataset.status = state.status;
    button.classList.toggle('current', session === activeSession);
    if (session === activeSession) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    button.children[0].textContent = session.label;
    button.children[1].textContent = detail;
    button.children[2].textContent = state.reason;
    button.title = context?.checkoutRoot || project.root;
    return [button];
  });
  if (
    rows.length !== list.children.length ||
    rows.some((row, index) => row !== list.children[index])
  )
    list.replaceChildren(...rows);
  $('#session-empty').hidden = rows.length > 0;
  if (focused && document.activeElement?.dataset.session !== focused)
    (rows.find((row) => row.dataset.session === focused) || $('#session-search')).focus();
}

function showSessions() {
  if ($('#session-dialog').open) return;
  $('#session-search').value = '';
  renderSessions();
  $('#session-dialog').showModal();
  $('#session-search').focus();
}

function showContext(session) {
  const context = session?.context;
  if (visibleRoot && settings)
    navigation.set(visibleRoot, {
      selected,
      expanded: [...expanded],
      treeMode: settings.treeMode,
      scroll: $('#tree').scrollTop,
      previewScroll: $('#preview-content').scrollTop,
    });
  visibleRoot = context?.checkoutRoot;
  treeVersion++;
  previewVersion++;
  lastPreview = null;
  changesBusy = false;
  const nav = navigation.get(visibleRoot);
  selected = nav?.selected || null;
  expanded = new Set(nav?.expanded || []);
  settings.treeMode = nav?.treeMode || 'files';
  markdownSource = false;
  $('#tree').replaceChildren();
  $('#preview-name').textContent = 'Preview';
  $('#preview-path').textContent = '';
  $('#file-status').textContent = '';
  $('#preview-note').hidden = true;
  emptyPreview(
    context?.status === 'starting'
      ? 'Starting worktree… Waiting for Claude to confirm its checkout.'
      : context?.status === 'unavailable'
        ? context.error || 'This checkout is unavailable.'
        : 'Select a file to preview it.',
  );
  const root = context?.checkoutRoot || project.root;
  $('#project-path').textContent = root.startsWith(project.home + '/')
    ? '~' + root.slice(project.home.length)
    : root;
  $('#project-path').title = root;
  $('#checkout-status').title = root;
  $('#checkout-status').textContent =
    context?.status === 'starting'
      ? 'Starting worktree…'
      : context?.status === 'unavailable'
        ? 'Checkout unavailable'
        : [
            context?.branch || root.split('/').pop(),
            context?.shared ? 'Shared Claude checkout' : '',
          ]
            .filter(Boolean)
            .join(' · ');
  layout();
  if (context?.status === 'ready') {
    const version = treeVersion;
    refreshTree()
      .then(() => {
        if (version + 1 === treeVersion) $('#tree').scrollTop = nav?.scroll || 0;
      })
      .catch(report);
    watch();
    const preview = previewVersion;
    loadPreview().then(() => {
      if (previewVersion === preview + 1) $('#preview-content').scrollTop = nav?.previewScroll || 0;
    });
  }
}

function acceptContext(context) {
  const session = sessions.get(context?.id);
  if (!session || session.context?.revision > context.revision) return;
  const changed =
    session.context?.revision !== context.revision || session.context?.shared !== context.shared;
  const restoreChanged =
    session.context?.status !== context.status ||
    session.context?.conversationId !== context.conversationId;
  session.context = context;
  if (!context.cwd && session.linkEpochs) {
    for (const epoch of session.linkEpochs) epoch.marker.dispose();
    session.linkEpochs = [];
  }
  if (changed && session === activeSession) showContext(session);
  if (session.restored && !session.starting && restoreChanged) showRestore(session);
  updateSession(session);
}

function activateSession(session, focus = true) {
  const changed = activeSession !== session;
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
  if (session) {
    api.active(session.id);
    if (changed) showContext(session);
    api.context(session.id).then(acceptContext).catch(report);
  } else if (changed) showContext(null);
  requestAnimationFrame(() => {
    if (session && activeSession === session) fitActiveTerminal();
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
      updateSession(session);
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

async function createTerminal(savedLabel, options = {}) {
  if (!project?.root) return;
  if (sessions.size >= 32) {
    message('Up to 32 terminals can be open in one window.');
    return;
  }
  const id = options.saved?.id || crypto.randomUUID();
  const label = savedLabel || `Terminal ${terminalCounter + 1}`;
  let context;
  try {
    context =
      options.saved || (await api.createTerminal(id, label, options.parentId ?? activeSession?.id));
  } catch (error) {
    report(error);
    return;
  }
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
    fontSize: settings.terminalFontSize,
    lineHeight: 1.24,
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
    starting: false,
    running: false,
    exited: false,
    closing: false,
    context,
    restored: Boolean(options.saved),
  };
  sessions.set(id, session);
  updateSession(session);
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
  term.parser.registerOscHandler(777, async (data) => {
    if (!data.startsWith('dwell;')) return false;
    try {
      const context = await api.claude(id, data);
      if (context) {
        acceptContext(context);
        const buffer = term.buffer.active;
        if (buffer.type === 'normal' && session.linkEpochs.at(-1)?.revision !== context.revision) {
          const marker = term.registerMarker(0);
          if (marker)
            session.linkEpochs.push({
              marker,
              x: buffer.cursorX,
              revision: context.revision,
              cwd: context.cwd,
            });
          if (session.linkEpochs.length > 128) session.linkEpochs.shift().marker.dispose();
        }
      }
    } catch (error) {
      report(error);
    }
    return true;
  });
  installFileLinks(session);
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
  if (options.saved) {
    session.starting = false;
    showRestore(session);
    updateTerminalControls();
  } else await startSession(session, options.mode || 'shell', options.task);
  if (!restoring) save();
  return session;
}

function showRestore(session) {
  session.pane.querySelector('.restore-session')?.remove();
  const card = node('div', 'restore-session');
  const missing = session.context.status === 'unavailable';
  card.append(
    node(
      'p',
      '',
      missing
        ? 'This checkout is unavailable. Open a terminal in the original project to recover; Claude will not resume there automatically.'
        : session.context.conversationId
          ? 'Resume this Claude conversation in its original checkout.'
          : 'This terminal is saved. Shell processes are not restored.',
    ),
  );
  if (session.error) card.prepend(node('p', 'session-error', session.error));
  if (session.context.conversationId) {
    const resume = node('button', 'text-button', 'Resume Claude');
    resume.disabled = missing;
    resume.addEventListener('click', () => startSession(session, 'resume'));
    card.append(resume);
  }
  const open = node(
    'button',
    'text-button',
    missing ? 'Open Terminal in Project' : 'Open Terminal',
  );
  open.addEventListener('click', () => startSession(session, missing ? 'recover' : 'shell'));
  card.append(open);
  session.pane.append(card);
}

async function startSession(session, mode, task) {
  const { terminal: term, id } = session;
  if (session.starting) return;
  session.starting = true;
  session.error = null;
  session.exited = false;
  session.attention = null;
  updateSession(session);
  session.pane.querySelectorAll('.restore-session button').forEach((button) => {
    button.disabled = true;
  });
  session.ready = api
    .start(id, term.cols, term.rows, mode, task)
    .then((result) => {
      if (result.existing) return;
      session.restored = false;
      session.pane.querySelector('.restore-session')?.remove();
      session.running = !session.exited;
      session.tabItem.classList.remove('ended');
      if (result.context) acceptContext(result.context);
      // A pane may have been resized while its shell was starting.
      if (session.running) api.resize(id, term.cols, term.rows);
    })
    .catch((error) => {
      session.error = error.message;
      term.writeln(`\r\nCould not start this session: ${error.message}`);
      message(error.message);
    })
    .finally(() => {
      session.starting = false;
      if (session.restored) showRestore(session);
      updateSession(session);
    });
  await session.ready;
  save();
}

function installFileLinks(session) {
  const term = session.terminal;
  let hovered;
  let pressed;
  session.pane.addEventListener('mouseleave', () => {
    pressed = null;
  });
  // Claude enables mouse reporting. Consume only modified file-link clicks before xterm sends them.
  session.pane.addEventListener(
    'mousedown',
    (event) => {
      if (!event.metaKey || !hovered || event.button !== 0) return;
      pressed = hovered;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  session.pane.addEventListener(
    'mouseup',
    (event) => {
      if (!pressed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.metaKey && pressed === hovered)
        openReference(session, pressed.reference, pressed.epoch).catch(report);
      pressed = null;
    },
    true,
  );
  session.linkEpochs = [];
  // Cursor edits/fullscreen redraws cannot reliably date a relative path. Leave those unlinked.
  const invalidate = () => {
    for (const epoch of session.linkEpochs) epoch.marker.dispose();
    session.linkEpochs = [];
    return false;
  };
  for (const final of ['A', 'B', 'E', 'F', 'G', 'H', 'f', 'd', 'J', 'K', 'L', 'M', 'P', 'X'])
    term.parser.registerCsiHandler({ final }, invalidate);
  term.onResize(invalidate);
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const buffer = term.buffer.active;
      let first = y - 1;
      let last = first;
      while (first > 0 && buffer.getLine(first)?.isWrapped && y - first < 16) first--;
      while (last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped && last - first < 16)
        last++;
      let text = '';
      const cells = [];
      for (let row = first; row <= last; row++) {
        const line = buffer.getLine(row);
        for (let col = 0; col < term.cols; col++) {
          const cell = line.getCell(col);
          if (cell.getWidth() === 0) continue;
          const chars = cell.getChars() || ' ';
          for (let i = 0; i < chars.length; i++) cells.push({ x: col + 1, y: row + 1 });
          text += chars;
        }
      }
      const links = references(text).flatMap((reference) => {
        const start = cells[reference.index];
        const end = cells[reference.index + reference.length - 1];
        if (!start || !end || start.y > y || end.y < y) return [];
        const epoch =
          buffer.type === 'normal'
            ? session.linkEpochs.findLast(
                (entry) =>
                  !entry.marker.isDisposed &&
                  (entry.marker.line < start.y - 1 ||
                    (entry.marker.line === start.y - 1 && entry.x < start.x)),
              )
            : null;
        if (!reference.path.startsWith('/') && !epoch?.cwd) return [];
        const hit = { reference, epoch: epoch?.revision };
        return [
          {
            text: reference.text,
            range: { start, end },
            hover() {
              hovered = hit;
            },
            leave() {
              if (hovered === hit) hovered = null;
            },
            activate(event) {
              if (event.metaKey) openReference(session, reference, epoch?.revision).catch(report);
            },
          },
        ];
      });
      callback(links);
    },
  });
}

async function openReference(session, reference, epoch) {
  if (session !== activeSession) return;
  const context = scope(session);
  const result = await api.fileLine(context, reference, epoch);
  if (session !== activeSession || session.context.revision !== context.revision) return;
  settings.treeMode = 'files';
  markdownSource = true;
  lastPreview = null;
  selected = result.relative;
  const loading = selectFile(result.relative);
  const version = previewVersion;
  await loading;
  if (
    session !== activeSession ||
    session.context.revision !== context.revision ||
    selected !== result.relative ||
    previewVersion !== version
  )
    return;
  const line = $('#preview-content').querySelectorAll('.source-line')[result.line - 1];
  if (!line) {
    $('#preview-note').hidden = false;
    $('#preview-note').replaceChildren(
      node('span', '', 'That line is outside the loaded text preview. '),
    );
    const open = node('button', 'text-button', 'Open in Default App');
    open.addEventListener('click', () => api.openFile(context, result.relative).catch(report));
    $('#preview-note').append(open);
    return;
  }
  line.classList.add('referenced-line');
  line.scrollIntoView({ block: 'center', inline: 'nearest' });
  message(
    `Line ${result.line}${result.column > 1 ? ` · Column ${result.column}` : ''} · Read-only`,
  );
  setTimeout(() => line.classList.remove('referenced-line'), 2200);
  refreshTree().catch(report);
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
api.onAttention(({ id, pending, status, reason }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.attention = { pending, status, reason };
  updateSession(session);
});
api.onFocusTerminal((id) => {
  const session = sessions.get(id);
  if (session) activateSession(session);
});
api.onContext(acceptContext);
window.addEventListener('focus', () => {
  if (activeSession) api.active(activeSession.id);
  if (settings?.treeMode === 'changes') refreshGit().catch(report);
});
api.onExit(({ id, exitCode }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.running = false;
  session.exited = true;
  session.attention = null;
  session.tabItem.classList.add('ended');
  session.terminal.writeln(`\r\n\x1b[90mSession ended (${exitCode}).\x1b[0m`);
  if (session.context.conversationId) {
    session.restored = true;
    showRestore(session);
  }
  api.context(id).then(acceptContext).catch(report);
  updateSession(session);
});
new ResizeObserver(() => requestAnimationFrame(fitActiveTerminal)).observe($('#terminal'));
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
  $('.terminal-heading').hidden = false;
  workspace.hidden = false;
  $('#project-path').textContent = value.root.startsWith(value.home + '/')
    ? '~' + value.root.slice(value.home.length)
    : value.root;
  $('#project-path').title = value.root;
  settings = {
    treeMode: 'files',
    treeWidth: window.innerWidth * 0.19,
    previewWidth: window.innerWidth * 0.32,
    showTree: false,
    showPreview: false,
    terminalFontSize: 14,
    hidden: false,
    wrap: true,
    ...value.settings,
  };
  settings.terminalFontSize = Number.isFinite(settings.terminalFontSize)
    ? Math.max(11, Math.min(24, settings.terminalFontSize))
    : 14;
  expanded = new Set(settings.expanded || []);
  selected = settings.selected || null;
  $('#toggle-hidden').setAttribute('aria-pressed', String(settings.hidden));
  layout();
  if (!sessions.size) {
    navigation.set(value.root, {
      selected,
      expanded: [...expanded],
      treeMode: settings.treeMode,
      scroll: 0,
    });
    restoring = true;
    if (value.tabs.length)
      for (const tab of value.tabs) await createTerminal(tab.label, { saved: tab });
    else await createTerminal();
    restoring = false;
  }
  await refreshTree();
  watch();
  await loadPreview();
  message('');
}

async function action(name) {
  const nameInput = document.activeElement?.matches('input') ? document.activeElement : null;
  if (name === 'copy') {
    const text = nameInput
      ? nameInput.value.slice(nameInput.selectionStart, nameInput.selectionEnd)
      : window.getSelection()?.toString() ||
        (!document.querySelector('dialog[open]') && activeSession?.terminal.getSelection());
    if (text) await api.copy(text);
    return;
  }
  if (name === 'paste') {
    if (nameInput) {
      const text = await api.paste();
      if (nameInput.isConnected) {
        const available =
          (nameInput.maxLength > 0 ? nameInput.maxLength : 8192) -
          nameInput.value.length +
          nameInput.selectionEnd -
          nameInput.selectionStart;
        nameInput.setRangeText(
          text.replace(/[\r\n]/g, ' ').slice(0, available),
          nameInput.selectionStart,
          nameInput.selectionEnd,
          'end',
        );
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    const target = activeSession;
    if (target) {
      target.terminal.focus();
      const text = await api.paste();
      if (sessions.has(target.id) && !document.querySelector('dialog[open]'))
        target.terminal.paste(text);
    }
    return;
  }
  if (!settings || document.querySelector('dialog[open]')) return;
  if (name === 'focus') {
    focusMode = !focusMode;
    layout();
    activeSession?.terminal.focus();
  }
  if (name === 'switch-session') showSessions();
  if (name === 'next-attention') {
    const session = nextAttention();
    if (session) activateSession(session);
  }
  if (name === 'zoom-in') zoomTerminal(1);
  if (name === 'zoom-out') zoomTerminal(-1);
  if (name === 'zoom-reset') zoomTerminal(0);
  if (name === 'tree' || name === 'preview') togglePane(name);
  if (name === 'terminal') activeSession?.terminal.focus();
  if (name === 'new-terminal') await createTerminal();
  if (name === 'new-worktree') showWorktreeDialog();
  if (name === 'claude-launcher') showLauncherDialog();
  if (name === 'file-reference') {
    $('#reference-value').value = activeSession?.terminal.getSelection() || '';
    $('#reference-error').textContent = '';
    $('#reference-dialog').showModal();
  }
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
let worktreeSource;
function showWorktreeDialog() {
  if (!activeSession) return;
  worktreeSource = scope();
  $('#worktree-origin').textContent = activeSession.context.checkoutRoot;
  $('#worktree-name').value = '';
  $('#worktree-error').textContent = '';
  $('#worktree-dialog').showModal();
}
function showLauncherDialog() {
  $('#launcher-command').value = project.launcher.command;
  $('#launcher-args').value = JSON.stringify(project.launcher.args);
  $('#launcher-error').textContent = '';
  $('#launcher-dialog').showModal();
}
for (const button of document.querySelectorAll('[data-close-dialog]'))
  button.addEventListener('click', () => button.closest('dialog').close());
$('#session-search').addEventListener('input', renderSessions);
$('#close-session-dialog').addEventListener('click', () => $('#session-dialog').close());
$('#session-dialog').addEventListener('close', () => activeSession?.terminal.focus());
$('#session-dialog').addEventListener('keydown', (event) => {
  const rows = [...$('#session-list').children];
  const index = rows.indexOf(document.activeElement);
  if (event.key === 'Enter' && event.target === $('#session-search')) rows[0]?.click();
  else if (event.key === 'ArrowDown') rows[Math.min(rows.length - 1, index + 1)]?.focus();
  else if (event.key === 'ArrowUp') {
    if (index <= 0) $('#session-search').focus();
    else rows[index - 1].focus();
  } else return;
  event.preventDefault();
});
$('#worktree-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const parent = sessions.get(worktreeSource.id);
  const task = $('#worktree-name').value.trim();
  if (!parent || parent.context.revision !== worktreeSource.revision) {
    $('#worktree-error').textContent =
      'The source checkout changed. Close this dialog and try again.';
    return;
  }
  if (
    !task ||
    [...task].some(
      (char) =>
        char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    $('#worktree-error').textContent = 'Use a task name without slashes or control characters.';
    return;
  }
  $('#worktree-dialog').close();
  await createTerminal(task, { mode: 'worktree', task, parentId: parent.id });
});
$('#launcher-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    project.launcher = await api.launcher({
      command: $('#launcher-command').value.trim(),
      args: JSON.parse($('#launcher-args').value),
    });
    $('#launcher-dialog').close();
  } catch (error) {
    $('#launcher-error').textContent = error.message;
  }
});
$('#reference-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = references($('#reference-value').value.trim());
  if (value.length !== 1 || !value[0].path.startsWith('/')) {
    $('#reference-error').textContent =
      'Enter one absolute path:line or path:line:column. Quote paths with spaces.';
    return;
  }
  try {
    await openReference(activeSession, value[0]);
    $('#reference-dialog').close();
  } catch (error) {
    $('#reference-error').textContent = error.message;
  }
});
$('#project-button').addEventListener('click', () => api.chooseFolder().catch(report));
$('#open-folder').addEventListener('click', () => api.chooseFolder().catch(report));
$('#toggle-tree').addEventListener('click', () => action('tree'));
$('#toggle-preview').addEventListener('click', () => action('preview'));
$('#close-preview').addEventListener('click', () => action('preview'));
$('#toggle-focus').addEventListener('click', () => action('focus'));
$('#switch-session').addEventListener('click', () => action('switch-session'));
$('#next-attention').addEventListener('click', () => action('next-attention'));
$('#preview-pane').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  togglePane('preview');
});
$('#review-changes').addEventListener('click', () => {
  if (!settings) return;
  focusMode = false;
  settings.showTree = true;
  if (window.innerWidth < 960) settings.showPreview = false;
  $('#show-changes').click();
});
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
$('#new-terminal-menu').addEventListener('click', () => api.newMenu().catch(report));
$('#new-terminal').addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api.newMenu().catch(report);
});
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
    const reference = event.dataTransfer.getData(fileDragType);
    const files = [...event.dataTransfer.files];
    try {
      const context = scope(target);
      const source = reference ? JSON.parse(reference) : null;
      if (source && (source.id !== context.id || source.revision !== context.revision))
        throw new Error('The file belongs to a different terminal context. Drag it again.');
      const text = source
        ? await api.reference(context, source.relative)
        : await api.droppedFiles(context, files);
      if (
        !sessions.has(target.id) ||
        !target.running ||
        target.context.revision !== context.revision
      )
        return;
      target.terminal.paste(text);
      if (target === activeSession) target.terminal.focus();
    } catch (error) {
      report(error);
    }
  },
  true,
);
api.onMenu((name) => action(name).catch(report));
api.onFiles((context) => {
  if (context.id !== activeSession?.id || context.revision !== activeSession.context.revision)
    return;
  refreshTree().then(watch).catch(report);
  loadPreview();
});
api.onProject((value) => openProject(value).catch(report));
refreshIcons();
api.project().then(openProject).catch(report);
