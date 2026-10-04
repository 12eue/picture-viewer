const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'pictureViewer',
  Object.freeze({
    getPathInfo: (targetPath) => ipcRenderer.invoke('fs:path-info', targetPath),
    listDirectory: (directoryPath) => ipcRenderer.invoke('fs:list-directory', directoryPath),
    openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
    openDirectoryDialog: () => ipcRenderer.invoke('dialog:open-directory'),
    onOpenPath: (callback) => {
      const listener = (_event, targetPath) => callback(targetPath);
      ipcRenderer.on('app:open-path', listener);

      return () => {
        ipcRenderer.removeListener('app:open-path', listener);
      };
    },
    platform: process.platform,
  }),
);
