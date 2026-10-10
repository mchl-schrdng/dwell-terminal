const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).then((result) => {
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
const listen = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('dwell', {
  project: () => call('project:get'),
  chooseFolder: () => call('project:choose'),
  list: (scope, relative, hidden) => call('files:list', scope, relative, hidden),
  changes: (scope) => call('git:changes', scope),
  diff: (scope, relative) => call('git:diff', scope, relative),
  reference: (scope, relative) => call('files:reference', scope, relative),
  fileLine: (scope, reference, epoch) => call('files:line', scope, reference, epoch),
  droppedFiles: (scope, files) =>
    call(
      'files:quote',
      scope,
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  preview: (scope, relative) => call('files:preview', scope, relative),
  openFile: (scope, relative) => call('files:open', scope, relative),
  reveal: (scope, relative) => call('files:reveal', scope, relative),
  watch: (scope, directories) => call('files:watch', scope, directories),
  save: (settings) => call('settings:save', settings),
  createTerminal: (id, label, parentId) => call('terminal:create', id, label, parentId),
  context: (id) => call('terminal:context', id),
  start: (id, cols, rows, mode, task) => call('terminal:start', id, cols, rows, mode, task),
  claude: (id, data) => call('terminal:claude', id, data),
  launcher: (value) => call('claude:launcher', value),
  newMenu: () => call('terminal:menu'),
  closeTerminal: (id) => call('terminal:close', id),
  input: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  ack: (id, size) => ipcRenderer.send('terminal:ack', id, size),
  bell: (id, label) => ipcRenderer.send('terminal:bell', id, label),
  progress: (id, value, label) => ipcRenderer.send('terminal:progress', id, value, label),
  active: (id) => ipcRenderer.send('terminal:active', id),
  copy: (text) => call('clipboard:write', text),
  paste: () => call('clipboard:read'),
  openLink: (url) => call('link:open', url),
  onData: (callback) => listen('terminal:data', callback),
  onExit: (callback) => listen('terminal:exit', callback),
  onContext: (callback) => listen('terminal:context', callback),
  onAttention: (callback) => listen('terminal:attention', callback),
  onFocusTerminal: (callback) => listen('terminal:focus', callback),
  onFiles: (callback) => listen('files:changed', callback),
  onProject: (callback) => listen('project:opened', callback),
  onMenu: (callback) => listen('menu:action', callback),
});
