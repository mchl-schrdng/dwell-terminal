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
  list: (relative, hidden) => call('files:list', relative, hidden),
  changes: () => call('git:changes'),
  diff: (relative) => call('git:diff', relative),
  reference: (relative) => call('files:reference', relative),
  droppedFiles: (files) =>
    call(
      'files:quote',
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  preview: (relative) => call('files:preview', relative),
  openFile: (relative) => call('files:open', relative),
  reveal: (relative) => call('files:reveal', relative),
  watch: (directories) => call('files:watch', directories),
  save: (settings) => call('settings:save', settings),
  start: (id, cols, rows) => call('terminal:start', id, cols, rows),
  closeTerminal: (id) => call('terminal:close', id),
  input: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  ack: (id, size) => ipcRenderer.send('terminal:ack', id, size),
  bell: (id, label) => ipcRenderer.send('terminal:bell', id, label),
  active: (id) => ipcRenderer.send('terminal:active', id),
  copy: (text) => call('clipboard:write', text),
  paste: () => call('clipboard:read'),
  openLink: (url) => call('link:open', url),
  onData: (callback) => listen('terminal:data', callback),
  onExit: (callback) => listen('terminal:exit', callback),
  onAttention: (callback) => listen('terminal:attention', callback),
  onFocusTerminal: (callback) => listen('terminal:focus', callback),
  onFiles: (callback) => listen('files:changed', callback),
  onProject: (callback) => listen('project:opened', callback),
  onMenu: (callback) => listen('menu:action', callback),
});
