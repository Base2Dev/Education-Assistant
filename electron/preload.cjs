// Modified / added lines: 1-11 (Expose openLink to renderer for opening saved links)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scholo', {
  request: (method, path, body) => ipcRenderer.invoke('scholo:request', { method, path, body }),
  importImage: (noteId, filename, bytes) => ipcRenderer.invoke('scholo:import-image', { noteId, filename, bytes }),
  exportNote: (noteId) => ipcRenderer.invoke('scholo:export-note', noteId),
  desktopInfo: () => ipcRenderer.invoke('scholo:desktop-info'),
  chooseWorkspace: () => ipcRenderer.invoke('scholo:choose-workspace'),
  startCapture: () => ipcRenderer.invoke('scholo:start-capture'),
  openLink: url => ipcRenderer.invoke('scholo:open-link', url),
  onCaptureSaved: callback => {
    const listener = (_event, note) => callback(note);
    ipcRenderer.on('scholo:capture-saved', listener);
    return () => ipcRenderer.removeListener('scholo:capture-saved', listener);
  },
  onWorkspaceChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('scholo:workspace-changed', listener);
    return () => ipcRenderer.removeListener('scholo:workspace-changed', listener);
  },
});
