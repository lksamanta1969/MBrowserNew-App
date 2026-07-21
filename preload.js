const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "electronAPI",
  {
    saveFile: (filePath, folderName) =>
    ipcRenderer.invoke("save-file", filePath, folderName),

    createFolder: (folderName) =>
      ipcRenderer.invoke("mdrive:create-folder", folderName)
  }
);