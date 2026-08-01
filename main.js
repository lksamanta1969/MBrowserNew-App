const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "MBrowser",
    icon: path.join(__dirname, "mbrowser-logo.ico"),

  webPreferences: {
    preload: path.join(__dirname, "preload.js"),

   contextIsolation: true,
    nodeIntegration: true,

    webviewTag: true,
    webSecurity: false,
    allowRunningInsecureContent: true
}  
  });

  win.loadFile("index.html");

  // Securely handle popups/new windows created by the webview (e.g., Firebase Auth Login)
  win.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true
        }
      }
    };
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.focus();
  });

  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {

  const serverProcess = spawn("node", ["server.js"], {
    cwd: __dirname,
    shell: true
  });

  serverProcess.stdout.on("data", (data) => {
    console.log("[SERVER]", data.toString());
  });

  serverProcess.stderr.on("data", (data) => {
    console.error("[SERVER ERROR]", data.toString());
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

// mdrive-এর জন্য ফাইল সেভ করার হ্যান্ডলার (Safe and untouched)

ipcMain.handle("save-file", async (event, sourcePath, folderName) => {
    try {
        console.log("SOURCE:", sourcePath);
        console.log("Folder:", folderName);


        const fileName = path.basename(sourcePath);

        const targetDir = folderName
            ? path.join(__dirname, "mdrive", ...folderName.split(/[/\\]/))
            : path.join(__dirname, "mdrive");

        const destPath = path.join(targetDir, fileName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    await fs.promises.copyFile(sourcePath, destPath);

console.log("DEST:", destPath);
console.log("COPY SUCCESS");

    return { success: true, fileName, path: destPath };

  } catch (error) {
    console.error("FULL ERROR:", error);

    return {
        success: false,
        error: error.message
    };
}

});
ipcMain.handle("mdrive:create-folder", async (event, folderName, parentPath) => {
    try {
        const folderPath = parentPath
            ? path.join(__dirname, "mdrive", ...parentPath.split(/[/\\]/), folderName)
            : path.join(__dirname, "mdrive", folderName);

        if (fs.existsSync(folderPath)) {
            return {
                success: false,
                message: "A folder with this name already exists in this location."
            };
        }

        fs.mkdirSync(folderPath, { recursive: true });

        return {
            success: true,
            message: "Folder created successfully"
        };

    } catch (error) {
        console.error(error);

        return {
            success: false,
            message: error.message
        };
    }
});

function mdriveDir(relativePath) {
    if (!relativePath) return path.join(__dirname, "mdrive");
    return path.join(__dirname, "mdrive", ...relativePath.split(/[/\\]/));
}

ipcMain.handle("mdrive:list", async (event, relativePath) => {
    try {
        const dirPath = mdriveDir(relativePath || "");

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            return { success: true, folders: [], files: [] };
        }

        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        return {
            success: true,
            folders: entries.filter(e => e.isDirectory()).map(e => e.name),
            files: entries.filter(e => e.isFile()).map(e => ({
                name: e.name,
                path: path.join(dirPath, e.name)
            }))
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("mdrive:rename-file", async (event, filePath, newName) => {
    try {
        const newPath = path.join(path.dirname(filePath), newName);

        if (fs.existsSync(newPath)) {
            return { success: false, error: "A file with this name already exists in this location." };
        }

        await fs.promises.rename(filePath, newPath);

        return { success: true, name: newName, path: newPath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("mdrive:rename-folder", async (event, relativePath, newName) => {
    try {
        const segments = relativePath.split(/[/\\]/);
        const parentPath = segments.slice(0, -1).join("/");
        const oldName = segments[segments.length - 1];
        const parentDir = mdriveDir(parentPath);
        const oldPath = path.join(parentDir, oldName);
        const newPath = path.join(parentDir, newName);

        if (fs.existsSync(newPath)) {
            return { success: false, error: "A folder with this name already exists in this location." };
        }

        await fs.promises.rename(oldPath, newPath);

        const newRelativePath = parentPath ? parentPath + "/" + newName : newName;

        return { success: true, newRelativePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("mdrive:delete-file", async (event, filePath) => {
    try {
        await fs.promises.unlink(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("mdrive:delete-folder", async (event, relativePath) => {
    try {
        if (!relativePath || !relativePath.trim()) {
            return { success: false, error: "Cannot delete the root MDrive folder." };
        }

        const dirPath = mdriveDir(relativePath);
        const entries = await fs.promises.readdir(dirPath);

        if (entries.length > 0) {
            return { success: false, error: "Cannot delete folder: it is not empty." };
        }

        await fs.promises.rmdir(dirPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("mdrive:open-file", async (event, filePath) => {
    try {
        const result = await shell.openPath(filePath);

        if (result) {
            return { success: false, error: result };
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("mdrive:download-file", async (event, sourcePath) => {
    try {
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: "Save File",
            defaultPath: path.basename(sourcePath)
        });

        if (canceled || !filePath) {
            return { success: false, canceled: true };
        }

        await fs.promises.copyFile(sourcePath, filePath);

        return { success: true, path: filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/* ===================== Bookmarks ===================== */

const BOOKMARKS_BAR_ID = "bookmarks_bar";
const OTHER_BOOKMARKS_ID = "other";

function bookmarksFilePath() {
    return path.join(app.getPath("userData"), "bookmarks.json");
}

function createBookmarkId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultBookmarksData() {
    return {
        version: 1,
        folders: [
            {
                id: BOOKMARKS_BAR_ID,
                name: "Bookmarks bar",
                parentId: null,
                order: 0,
                isSystem: true
            },
            {
                id: OTHER_BOOKMARKS_ID,
                name: "Other bookmarks",
                parentId: null,
                order: 1,
                isSystem: true
            }
        ],
        bookmarks: []
    };
}

function readBookmarksStore() {
    const filePath = bookmarksFilePath();

    if (!fs.existsSync(filePath)) {
        const data = defaultBookmarksData();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return data;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw || "{}");

        if (!Array.isArray(data.folders) || !Array.isArray(data.bookmarks)) {
            return defaultBookmarksData();
        }

        const hasBar = data.folders.some((f) => f.id === BOOKMARKS_BAR_ID);
        const hasOther = data.folders.some((f) => f.id === OTHER_BOOKMARKS_ID);

        if (!hasBar) {
            data.folders.unshift({
                id: BOOKMARKS_BAR_ID,
                name: "Bookmarks bar",
                parentId: null,
                order: 0,
                isSystem: true
            });
        }

        if (!hasOther) {
            data.folders.push({
                id: OTHER_BOOKMARKS_ID,
                name: "Other bookmarks",
                parentId: null,
                order: 1,
                isSystem: true
            });
        }

        return data;
    } catch (error) {
        console.error("[BOOKMARKS] Failed to read store:", error);
        return defaultBookmarksData();
    }
}

function writeBookmarksStore(data) {
    const filePath = bookmarksFilePath();
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function buildBookmarkHtml(data) {
    const foldersByParent = {};
    const bookmarksByFolder = {};

    data.folders.forEach((folder) => {
        const key = folder.parentId || "root";
        if (!foldersByParent[key]) foldersByParent[key] = [];
        foldersByParent[key].push(folder);
    });

    data.bookmarks.forEach((bookmark) => {
        const key = bookmark.folderId || OTHER_BOOKMARKS_ID;
        if (!bookmarksByFolder[key]) bookmarksByFolder[key] = [];
        bookmarksByFolder[key].push(bookmark);
    });

    Object.keys(foldersByParent).forEach((key) => {
        foldersByParent[key].sort((a, b) => (a.order || 0) - (b.order || 0));
    });
    Object.keys(bookmarksByFolder).forEach((key) => {
        bookmarksByFolder[key].sort((a, b) => (a.order || 0) - (b.order || 0));
    });

    function renderFolder(folderId) {
        let html = "";
        const childFolders = foldersByParent[folderId] || [];
        const items = bookmarksByFolder[folderId] || [];

        childFolders.forEach((folder) => {
            html += `    <DT><H3>${escapeHtml(folder.name)}</H3>\n`;
            html += "    <DL><p>\n";
            html += renderFolder(folder.id);
            html += "    </DL><p>\n";
        });

        items.forEach((bookmark) => {
            const added = bookmark.dateAdded
                ? Math.floor(bookmark.dateAdded / 1000)
                : Math.floor(Date.now() / 1000);
            html += `    <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${added}">${escapeHtml(bookmark.title)}</A>\n`;
        });

        return html;
    }

    return [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<!-- This is an automatically generated file.",
        "     It will be read and overwritten.",
        "     DO NOT EDIT! -->",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        "<TITLE>Bookmarks</TITLE>",
        "<H1>Bookmarks</H1>",
        "<DL><p>",
        renderFolder("root"),
        "</DL><p>",
        ""
    ].join("\n");
}

function parseBookmarkHtml(html) {
    const folders = [];
    const bookmarks = [];
    const folderStack = [OTHER_BOOKMARKS_ID];
    let pendingFolderName = null;
    let orderCounters = { [OTHER_BOOKMARKS_ID]: 0, [BOOKMARKS_BAR_ID]: 0 };

    function nextOrder(folderId) {
        if (orderCounters[folderId] === undefined) orderCounters[folderId] = 0;
        return orderCounters[folderId]++;
    }

    const tokenRegex = /<(DT|\/?DL|H3|A)\b([^>]*)>([^<]*)/gi;
    let match;

    while ((match = tokenRegex.exec(html)) !== null) {
        const tag = match[1].toUpperCase();
        const attrs = match[2] || "";
        const text = (match[3] || "").trim();

        if (tag === "H3") {
            if (/PERSONAL_TOOLBAR_FOLDER\s*=\s*"true"/i.test(attrs)) {
                pendingFolderName = "__BOOKMARKS_BAR__";
            } else if (text) {
                pendingFolderName = text
                    .replace(/&amp;/g, "&")
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/&quot;/g, '"');
            }
        } else if (tag === "DL" && pendingFolderName) {
            const parentId = folderStack[folderStack.length - 1];
            let folderId;

            if (
                pendingFolderName === "__BOOKMARKS_BAR__" ||
                /^bookmarks?\s*bar$/i.test(pendingFolderName) ||
                /^favorites?\s*bar$/i.test(pendingFolderName)
            ) {
                folderId = BOOKMARKS_BAR_ID;
            } else if (/^other\s*bookmarks?$/i.test(pendingFolderName)) {
                folderId = OTHER_BOOKMARKS_ID;
            } else {
                folderId = createBookmarkId("folder");
                folders.push({
                    id: folderId,
                    name: pendingFolderName,
                    parentId,
                    order: nextOrder(parentId),
                    isSystem: false
                });
            }

            folderStack.push(folderId);
            pendingFolderName = null;
        } else if (tag === "/DL") {
            if (folderStack.length > 1) folderStack.pop();
            pendingFolderName = null;
        } else if (tag === "A") {
            const hrefMatch = attrs.match(/HREF\s*=\s*"([^"]*)"/i) || attrs.match(/HREF\s*=\s*'([^']*)'/i);
            const url = hrefMatch ? hrefMatch[1] : "";
            if (!url) continue;

            const title = text
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"') || url;
            const folderId = folderStack[folderStack.length - 1] || OTHER_BOOKMARKS_ID;

            bookmarks.push({
                id: createBookmarkId("bm"),
                title,
                url,
                folderId,
                dateAdded: Date.now(),
                order: nextOrder(folderId)
            });
        }
    }

    return { folders, bookmarks };
}

ipcMain.handle("bookmarks:get", async () => {
    try {
        return { success: true, data: readBookmarksStore() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:add", async (event, payload) => {
    try {
        const data = readBookmarksStore();
        const folderId = payload.folderId || BOOKMARKS_BAR_ID;
        const folderExists = data.folders.some((f) => f.id === folderId);

        if (!folderExists) {
            return { success: false, error: "Folder not found." };
        }

        const url = (payload.url || "").trim();
        if (!url) {
            return { success: false, error: "URL is required." };
        }

        const existing = data.bookmarks.find(
            (b) => b.url === url && b.folderId === folderId
        );
        if (existing) {
            return { success: true, data, bookmark: existing, alreadyExists: true };
        }

        const sameFolder = data.bookmarks.filter((b) => b.folderId === folderId);
        const bookmark = {
            id: createBookmarkId("bm"),
            title: (payload.title || url).trim() || url,
            url,
            folderId,
            dateAdded: Date.now(),
            order: sameFolder.length
        };

        data.bookmarks.push(bookmark);
        writeBookmarksStore(data);

        return { success: true, data, bookmark };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:update", async (event, payload) => {
    try {
        const data = readBookmarksStore();
        const index = data.bookmarks.findIndex((b) => b.id === payload.id);

        if (index < 0) {
            return { success: false, error: "Bookmark not found." };
        }

        const current = data.bookmarks[index];
        const nextFolderId = payload.folderId || current.folderId;

        if (!data.folders.some((f) => f.id === nextFolderId)) {
            return { success: false, error: "Folder not found." };
        }

        data.bookmarks[index] = {
            ...current,
            title: payload.title !== undefined ? String(payload.title).trim() || current.title : current.title,
            url: payload.url !== undefined ? String(payload.url).trim() || current.url : current.url,
            folderId: nextFolderId
        };

        writeBookmarksStore(data);
        return { success: true, data, bookmark: data.bookmarks[index] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:delete", async (event, id) => {
    try {
        const data = readBookmarksStore();
        const before = data.bookmarks.length;
        data.bookmarks = data.bookmarks.filter((b) => b.id !== id);

        if (data.bookmarks.length === before) {
            return { success: false, error: "Bookmark not found." };
        }

        writeBookmarksStore(data);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:add-folder", async (event, payload) => {
    try {
        const data = readBookmarksStore();
        const name = (payload.name || "").trim();
        const parentId = payload.parentId || OTHER_BOOKMARKS_ID;

        if (!name) {
            return { success: false, error: "Folder name is required." };
        }

        if (!data.folders.some((f) => f.id === parentId)) {
            return { success: false, error: "Parent folder not found." };
        }

        const siblings = data.folders.filter((f) => f.parentId === parentId);
        const folder = {
            id: createBookmarkId("folder"),
            name,
            parentId,
            order: siblings.length,
            isSystem: false
        };

        data.folders.push(folder);
        writeBookmarksStore(data);

        return { success: true, data, folder };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:update-folder", async (event, payload) => {
    try {
        const data = readBookmarksStore();
        const index = data.folders.findIndex((f) => f.id === payload.id);

        if (index < 0) {
            return { success: false, error: "Folder not found." };
        }

        if (data.folders[index].isSystem && payload.name !== undefined) {
            // System folders keep their identity; renaming is allowed for display only except bar/other labels stay fixed
            if (data.folders[index].id === BOOKMARKS_BAR_ID || data.folders[index].id === OTHER_BOOKMARKS_ID) {
                return { success: false, error: "System folders cannot be renamed." };
            }
        }

        if (payload.name !== undefined) {
            const name = String(payload.name).trim();
            if (!name) {
                return { success: false, error: "Folder name is required." };
            }
            data.folders[index].name = name;
        }

        writeBookmarksStore(data);
        return { success: true, data, folder: data.folders[index] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:delete-folder", async (event, id) => {
    try {
        const data = readBookmarksStore();
        const folder = data.folders.find((f) => f.id === id);

        if (!folder) {
            return { success: false, error: "Folder not found." };
        }

        if (folder.isSystem || id === BOOKMARKS_BAR_ID || id === OTHER_BOOKMARKS_ID) {
            return { success: false, error: "System folders cannot be deleted." };
        }

        const toDelete = new Set([id]);
        let changed = true;

        while (changed) {
            changed = false;
            data.folders.forEach((f) => {
                if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
                    toDelete.add(f.id);
                    changed = true;
                }
            });
        }

        data.folders = data.folders.filter((f) => !toDelete.has(f.id));
        data.bookmarks = data.bookmarks.filter((b) => !toDelete.has(b.folderId));
        writeBookmarksStore(data);

        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:export-html", async () => {
    try {
        const data = readBookmarksStore();
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: "Export Bookmarks",
            defaultPath: "bookmarks.html",
            filters: [
                { name: "HTML Bookmarks", extensions: ["html", "htm"] },
                { name: "All Files", extensions: ["*"] }
            ]
        });

        if (canceled || !filePath) {
            return { success: false, canceled: true };
        }

        await fs.promises.writeFile(filePath, buildBookmarkHtml(data), "utf8");
        return { success: true, path: filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("bookmarks:import-html", async () => {
    try {
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: "Import Bookmarks",
            properties: ["openFile"],
            filters: [
                { name: "HTML Bookmarks", extensions: ["html", "htm"] },
                { name: "All Files", extensions: ["*"] }
            ]
        });

        if (canceled || !filePaths || !filePaths.length) {
            return { success: false, canceled: true };
        }

        const html = await fs.promises.readFile(filePaths[0], "utf8");
        const parsed = parseBookmarkHtml(html);
        const data = readBookmarksStore();

        parsed.folders.forEach((folder) => {
            if (!data.folders.some((f) => f.id === folder.id)) {
                data.folders.push(folder);
            }
        });

        const existingUrls = new Set(data.bookmarks.map((b) => `${b.folderId}::${b.url}`));
        let importedCount = 0;

        parsed.bookmarks.forEach((bookmark) => {
            const key = `${bookmark.folderId}::${bookmark.url}`;
            if (existingUrls.has(key)) return;
            data.bookmarks.push(bookmark);
            existingUrls.add(key);
            importedCount += 1;
        });

        writeBookmarksStore(data);

        return {
            success: true,
            data,
            importedCount,
            folderCount: parsed.folders.length
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/* ===================== History ===================== */

const HISTORY_MAX_ENTRIES = 10000;

function historyFilePath() {
    return path.join(app.getPath("userData"), "history.json");
}

function createHistoryId() {
    return `hist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultHistoryData() {
    return {
        version: 1,
        entries: []
    };
}

function readHistoryStore() {
    const filePath = historyFilePath();

    if (!fs.existsSync(filePath)) {
        const data = defaultHistoryData();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return data;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw || "{}");

        if (!Array.isArray(data.entries)) {
            return defaultHistoryData();
        }

        return {
            version: data.version || 1,
            entries: data.entries
        };
    } catch (error) {
        console.error("[HISTORY] Failed to read store:", error);
        return defaultHistoryData();
    }
}

function writeHistoryStore(data) {
    const filePath = historyFilePath();
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (Array.isArray(data.entries) && data.entries.length > HISTORY_MAX_ENTRIES) {
        data.entries.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
        data.entries = data.entries.slice(0, HISTORY_MAX_ENTRIES);
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function startOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function endOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
}

function getHistoryRangeBounds(range) {
    const now = Date.now();
    const todayStart = startOfLocalDay(now);
    const todayEnd = endOfLocalDay(now);
    const dayMs = 24 * 60 * 60 * 1000;

    switch (range) {
        case "today":
            return { from: todayStart, to: todayEnd };
        case "yesterday":
            return { from: todayStart - dayMs, to: todayStart - 1 };
        case "last7":
            return { from: todayStart - 6 * dayMs, to: todayEnd };
        case "lastMonth":
            return { from: todayStart - 29 * dayMs, to: todayEnd };
        case "all":
        default:
            return { from: 0, to: now };
    }
}

function normalizeHistoryUrl(url) {
    return String(url || "").trim();
}

function isRecordableHistoryUrl(url) {
    if (!url) return false;
    if (url === "about:blank") return false;
    if (url.startsWith("chrome://") || url.startsWith("chrome-error://")) return false;
    if (url.startsWith("data:")) return false;
    return url.startsWith("http://") || url.startsWith("https://");
}

ipcMain.handle("history:get", async () => {
    try {
        return { success: true, data: readHistoryStore() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("history:record", async (event, payload) => {
    try {
        const url = normalizeHistoryUrl(payload && payload.url);
        if (!isRecordableHistoryUrl(url)) {
            return { success: false, error: "URL is not recordable.", skipped: true };
        }

        const data = readHistoryStore();
        const now = Number(payload.visitTime) || Date.now();
        const title = String((payload && payload.title) || "").trim() || url;
        const existing = data.entries.find((entry) => entry.url === url);

        if (existing) {
            // Avoid double-count from rapid did-navigate + in-page for same URL
            if (existing.lastVisited && now - existing.lastVisited < 1500) {
                if (title && title !== url) existing.title = title;
                writeHistoryStore(data);
                return { success: true, data, entry: existing, deduped: true };
            }

            existing.title = title || existing.title;
            existing.visitCount = (existing.visitCount || 1) + 1;
            existing.lastVisited = now;
            writeHistoryStore(data);
            return { success: true, data, entry: existing };
        }

        const entry = {
            id: createHistoryId(),
            url,
            title,
            visitTime: now,
            visitCount: 1,
            lastVisited: now
        };

        data.entries.unshift(entry);
        writeHistoryStore(data);

        return { success: true, data, entry };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("history:update-title", async (event, payload) => {
    try {
        const url = normalizeHistoryUrl(payload && payload.url);
        const title = String((payload && payload.title) || "").trim();

        if (!url || !title) {
            return { success: false, error: "URL and title are required." };
        }

        const data = readHistoryStore();
        const entry = data.entries.find((item) => item.url === url);

        if (!entry) {
            return { success: false, error: "History entry not found.", skipped: true };
        }

        entry.title = title;
        writeHistoryStore(data);

        return { success: true, data, entry };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("history:delete", async (event, payload) => {
    try {
        const data = readHistoryStore();
        const ids = Array.isArray(payload)
            ? payload
            : Array.isArray(payload && payload.ids)
              ? payload.ids
              : payload && payload.id
                ? [payload.id]
                : [];

        if (!ids.length) {
            return { success: false, error: "No history ids provided." };
        }

        const idSet = new Set(ids.map(String));
        const before = data.entries.length;
        data.entries = data.entries.filter((entry) => !idSet.has(String(entry.id)));

        writeHistoryStore(data);

        return {
            success: true,
            data,
            deletedCount: before - data.entries.length
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("history:delete-range", async (event, range) => {
    try {
        const data = readHistoryStore();
        const bounds = getHistoryRangeBounds(range || "all");
        const before = data.entries.length;

        if (range === "all") {
            data.entries = [];
        } else {
            data.entries = data.entries.filter((entry) => {
                const ts = entry.lastVisited || entry.visitTime || 0;
                return ts < bounds.from || ts > bounds.to;
            });
        }

        writeHistoryStore(data);

        return {
            success: true,
            data,
            deletedCount: before - data.entries.length
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
