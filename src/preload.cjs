const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('webCanvas', {
  desktop: true,
  invoke: (action, payload) => ipcRenderer.invoke('canvas:command', action, payload),
  layout: (payload) => ipcRenderer.send('canvas:layout', payload),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('canvas:event', listener);
    return () => ipcRenderer.removeListener('canvas:event', listener);
  }
});
