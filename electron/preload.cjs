const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPet', {
  invoke: (command, args) => ipcRenderer.invoke(command, args),
  emit: (event, payload) => ipcRenderer.invoke('desktop:event', { event, payload }),
  listen: (event, callback) => {
    const listener = (_ipcEvent, payload) => callback({ payload });
    ipcRenderer.on(`desktop:event:${event}`, listener);
    return Promise.resolve(() =>
      ipcRenderer.removeListener(`desktop:event:${event}`, listener)
    );
  },
  onWindowFocus: callback => {
    const listener = (_ipcEvent, focused) => callback(focused);
    ipcRenderer.on('window:focus-changed', listener);
    return () => ipcRenderer.removeListener('window:focus-changed', listener);
  },
  onWindowMoved: callback => {
    const listener = (_ipcEvent, position) => callback(position);
    ipcRenderer.on('window:moved', listener);
    return () => ipcRenderer.removeListener('window:moved', listener);
  },
  onGlobalCursorMove: callback => {
    const listener = (_ipcEvent, position) => callback(position);
    ipcRenderer.on('cursor:global-move', listener);
    ipcRenderer.invoke('cursor:subscribe').catch(error => {
      console.error('Could not subscribe to global cursor movement:', error);
    });
    return () => ipcRenderer.removeListener('cursor:global-move', listener);
  },
  onCloseRequested: callback => {
    const listener = () => callback();
    ipcRenderer.on('window:close-requested', listener);
    return () => ipcRenderer.removeListener('window:close-requested', listener);
  },
  setIgnoreMouseEvents: ignore =>
    ipcRenderer.invoke('window:set-ignore-mouse-events', { ignore }),
  moveDragging: (x, y) => ipcRenderer.invoke('window:move-dragging', { x, y })
});
