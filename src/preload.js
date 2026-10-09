const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  exportFile: (opts) => ipcRenderer.invoke('export-file', opts),
  confirmDiscard: (message) => ipcRenderer.invoke('confirm-discard', message),

  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  writeClipboardPng: (dataUrl) => ipcRenderer.invoke('clipboard-write-png', dataUrl),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard-write-text', text),

  setFullScreen: (on) => ipcRenderer.send('set-fullscreen', on),
  setTitle: (t) => ipcRenderer.send('set-title', t),
  setEdited: (v) => ipcRenderer.send('set-edited', v),
  setClipboardWatch: (v) => ipcRenderer.send('set-clipboard-watch', v),
  ready: () => ipcRenderer.send('renderer-ready'),
  closeCancelled: () => ipcRenderer.send('close-cancelled'),
  closeConfirmed: () => ipcRenderer.send('close-confirmed'),

  onMenu: on('menu'),
  onFileOpened: on('file-opened'),
  onClipboardChanged: on('clipboard-changed'),
  onClipboardWatchState: on('clipboard-watch-state'),
  onRequestClose: on('request-close'),
});
