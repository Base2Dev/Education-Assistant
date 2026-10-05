const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('capture', {
  data: () => ipcRenderer.invoke('capture:data'),
  select: rectangle => ipcRenderer.invoke('capture:select', rectangle),
  cancel: () => ipcRenderer.invoke('capture:cancel'),
  save: input => ipcRenderer.invoke('capture:save', input),
});
