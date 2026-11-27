const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pmDesktop', {
  isDesktop: true,
  hasProjector: () => ipcRenderer.invoke('pm:hasProjector'),
});
