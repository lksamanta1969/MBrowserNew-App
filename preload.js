const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "electronAPI",
  {
    saveFile: (file, folderName) => {
      const filePath = file && file.path;
      if (!filePath) {
        return Promise.resolve({ success: false, error: "File path not available." });
      }
      return ipcRenderer.invoke("save-file", filePath, folderName);
    },

    createFolder: (folderName, parentPath) =>
      ipcRenderer.invoke("mdrive:create-folder", folderName, parentPath || ""),

    listDirectory: (relativePath) =>
      ipcRenderer.invoke("mdrive:list", relativePath || ""),

    renameFile: (filePath, newName) =>
      ipcRenderer.invoke("mdrive:rename-file", filePath, newName),

    renameFolder: (relativePath, newName) =>
      ipcRenderer.invoke("mdrive:rename-folder", relativePath, newName),

    deleteFile: (filePath) =>
      ipcRenderer.invoke("mdrive:delete-file", filePath),

    deleteFolder: (relativePath) =>
      ipcRenderer.invoke("mdrive:delete-folder", relativePath),

    openFile: (filePath) =>
      ipcRenderer.invoke("mdrive:open-file", filePath),

    downloadFile: (sourcePath) =>
      ipcRenderer.invoke("mdrive:download-file", sourcePath)
  }
);
