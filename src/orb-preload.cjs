const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orb', {
  open: () => ipcRenderer.send('orb:open'),
  drag: (phase) => ipcRenderer.send('orb:drag', phase),
  onState: (callback) => ipcRenderer.on('orb:state', (_event, value) => callback(value)),
});
