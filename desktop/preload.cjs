const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('invyrixDesktop', Object.freeze({
  linkInstitute: (id, slug) => ipcRenderer.invoke('link-institute', { id, slug })
}));
