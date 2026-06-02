const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "electronAPI",
  {
    saveFile: (filePath) =>
      ipcRenderer.invoke(
        "save-file",
        filePath
      )
  }
);