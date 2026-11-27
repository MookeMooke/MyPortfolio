const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pmDesktop', {
  isDesktop: true,
  version: ipcRenderer.sendSync('pm:version'),
  hasProjector: () => ipcRenderer.invoke('pm:hasProjector'),
  remoteInfo: () => ipcRenderer.invoke('pm:remoteInfo'),
  sendState: (state) => ipcRenderer.send('pm:state', state),
  onRemote: (fn) => ipcRenderer.on('pm:remote', (e, cmd) => fn(cmd)),
});
