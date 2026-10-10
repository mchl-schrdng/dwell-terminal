const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orb', {
  open: (target) => ipcRenderer.send('orb:open', target),
  card: (visible) => ipcRenderer.send('orb:card', visible),
  drag: (phase) => ipcRenderer.send('orb:drag', phase),
  onState: (callback) => ipcRenderer.on('orb:state', (_event, value) => callback(value)),
  onLayout: (callback) => ipcRenderer.on('orb:layout', (_event, value) => callback(value)),
});
