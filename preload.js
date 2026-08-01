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
      ipcRenderer.invoke("mdrive:download-file", sourcePath),

    bookmarksGet: () =>
      ipcRenderer.invoke("bookmarks:get"),

    bookmarksAdd: (payload) =>
      ipcRenderer.invoke("bookmarks:add", payload),

    bookmarksUpdate: (payload) =>
      ipcRenderer.invoke("bookmarks:update", payload),

    bookmarksDelete: (id) =>
      ipcRenderer.invoke("bookmarks:delete", id),

    bookmarksAddFolder: (payload) =>
      ipcRenderer.invoke("bookmarks:add-folder", payload),

    bookmarksUpdateFolder: (payload) =>
      ipcRenderer.invoke("bookmarks:update-folder", payload),

    bookmarksDeleteFolder: (id) =>
      ipcRenderer.invoke("bookmarks:delete-folder", id),

    bookmarksImportHtml: () =>
      ipcRenderer.invoke("bookmarks:import-html"),

    bookmarksExportHtml: () =>
      ipcRenderer.invoke("bookmarks:export-html"),

    historyGet: () =>
      ipcRenderer.invoke("history:get"),

    historyRecord: (payload) =>
      ipcRenderer.invoke("history:record", payload),

    historyUpdateTitle: (payload) =>
      ipcRenderer.invoke("history:update-title", payload),

    historyDelete: (payload) =>
      ipcRenderer.invoke("history:delete", payload),

    historyDeleteRange: (range) =>
      ipcRenderer.invoke("history:delete-range", range),

    settingsGet: () =>
      ipcRenderer.invoke("settings:get"),

    settingsSet: (patch) =>
      ipcRenderer.invoke("settings:set", patch),

    settingsReset: () =>
      ipcRenderer.invoke("settings:reset"),

    settingsPickDownloadFolder: () =>
      ipcRenderer.invoke("settings:pick-download-folder"),

    settingsGetAbout: () =>
      ipcRenderer.invoke("settings:get-about"),

    settingsClearPrivacy: (target) =>
      ipcRenderer.invoke("settings:clear-privacy", target)
  }
);
