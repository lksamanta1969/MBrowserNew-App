const { app, BrowserWindow, ipcMain, shell, dialog, session, Notification, clipboard } = require("electron");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createVaultSession } = require("./vault/VaultSession");
const { isMigrationComplete, deepClone, migrateVault } = require("./vault/VaultMigration");
const { createVaultAccess } = require("./vault/VaultAccess");

let shellWebContents = null;

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

  shellWebContents = win.webContents;

  win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    webPreferences.preload = path.join(__dirname, "preload.js");
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = false;
    if (params && "preload" in params) {
      delete params.preload;
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

  registerBrowserDownloadCapture();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
    try {
        flushDownloadsPersist();
    } catch (e) {
        /* ignore */
    }
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", () => {
    try {
        flushDownloadsPersist();
    } catch (e) {
        /* ignore */
    }
});

// mdrive-à¦à¦° à¦œà¦¨à§à¦¯ à¦«à¦¾à¦‡à¦² à¦¸à§‡à¦­ à¦•à¦°à¦¾à¦° à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à¦²à¦¾à¦° (Safe and untouched)

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

/** Strip openApp cache-bust (?v=) so internal MBrowser app bookmarks dedupe correctly. */
function normalizeBookmarkUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return raw;

    try {
        const parsed = new URL(raw);
        if (
            parsed.protocol === "http:" &&
            parsed.hostname === "localhost" &&
            parsed.port === "3000" &&
            /^\/apps\/[^/]+\/index\.html$/i.test(parsed.pathname)
        ) {
            parsed.searchParams.delete("v");
            const qs = parsed.searchParams.toString();
            parsed.search = qs ? "?" + qs : "";
            return parsed.href;
        }
    } catch (e) {
        /* ignore invalid URLs */
    }

    return raw;
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

        const url = normalizeBookmarkUrl((payload.url || "").trim());
        if (!url) {
            return { success: false, error: "URL is required." };
        }

        const existing = data.bookmarks.find(
            (b) =>
                normalizeBookmarkUrl(b.url) === url &&
                b.folderId === folderId
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

        const nextUrl =
            payload.url !== undefined
                ? normalizeBookmarkUrl(String(payload.url).trim()) || current.url
                : current.url;

        const duplicate = data.bookmarks.find(
            (b) =>
                b.id !== payload.id &&
                normalizeBookmarkUrl(b.url) === nextUrl &&
                b.folderId === nextFolderId
        );
        if (duplicate) {
            return {
                success: false,
                error: "A bookmark with this URL already exists in that folder."
            };
        }

        data.bookmarks[index] = {
            ...current,
            title: payload.title !== undefined ? String(payload.title).trim() || current.title : current.title,
            url: nextUrl,
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

const HISTORY_MAX_ENTRIES_DEFAULT = 10000;

function getHistoryMaxEntries() {
    try {
        const settings = readSettingsStore();
        const max = Number(settings && settings.history && settings.history.maxEntries);
        if (Number.isFinite(max) && max > 0) return Math.floor(max);
    } catch (e) {
        /* settings may not be ready */
    }
    return HISTORY_MAX_ENTRIES_DEFAULT;
}

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

    if (Array.isArray(data.entries) && data.entries.length > getHistoryMaxEntries()) {
        data.entries.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
        data.entries = data.entries.slice(0, getHistoryMaxEntries());
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

/* ===================== Settings ===================== */

function settingsFilePath() {
    return path.join(app.getPath("userData"), "settings.json");
}

function defaultSettingsData() {
    return {
        version: 1,
        general: {
            browserName: "MBrowser",
            homepage: "mbrowser://home",
            newTabBehavior: "home",
            defaultZoom: 100
        },
        appearance: {
            theme: "system",
            accentColor: "#b45309",
            compactMode: false,
            showBookmarksBar: true,
            showStatusBar: false
        },
        startup: {
            mode: "newTab",
            restorePreviousSession: false
        },
        searchEngine: {
            provider: "google",
            customSearchUrl: "https://example.com/search?q=%s"
        },
        downloads: {
            defaultFolder: "",
            askBeforeDownload: true,
            autoOpenDownloads: false,
            showNotifications: true
        },
        privacy: {
            doNotTrack: false,
            safeBrowsing: false,
            offerToSavePasswords: true,
            enableLoginDetection: true
        },
        bookmarks: {
            showBookmarksBar: true
        },
        history: {
            retentionDays: 90,
            maxEntries: 10000,
            autoCleanup: false
        },
        mdrive: {
            defaultWorkspace: "mdrive",
            autoOpen: false,
            recentFolder: "",
            syncEnabled: false
        },
        advanced: {
            hardwareAcceleration: true,
            experimentalFeatures: false,
            verboseLogging: false
        }
    };
}

function deepMergeSettings(target, source) {
    const output = { ...(target || {}) };
    Object.keys(source || {}).forEach((key) => {
        const value = source[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
            output[key] = deepMergeSettings(target ? target[key] : {}, value);
        } else {
            output[key] = value;
        }
    });
    return output;
}

function readSettingsStore() {
    const filePath = settingsFilePath();
    const defaults = defaultSettingsData();

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), "utf8");
        return defaults;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw || "{}");
        return deepMergeSettings(defaults, data);
    } catch (error) {
        console.error("[SETTINGS] Failed to read store:", error);
        return defaults;
    }
}

function writeSettingsStore(data) {
    const filePath = settingsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (data.appearance && data.bookmarks) {
        if (data.appearance.showBookmarksBar !== undefined) {
            data.bookmarks.showBookmarksBar = !!data.appearance.showBookmarksBar;
        } else if (data.bookmarks.showBookmarksBar !== undefined) {
            data.appearance.showBookmarksBar = !!data.bookmarks.showBookmarksBar;
        }
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function getStableCommit() {
    try {
        return execSync("git rev-parse --short HEAD", {
            cwd: __dirname,
            encoding: "utf8"
        }).trim();
    } catch (e) {
        return "9d8da19";
    }
}

ipcMain.handle("settings:get", async () => {
    try {
        return { success: true, data: readSettingsStore() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("settings:set", async (event, patch) => {
    try {
        const current = readSettingsStore();
        const next = deepMergeSettings(current, patch || {});
        writeSettingsStore(next);
        return { success: true, data: next };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("settings:reset", async () => {
    try {
        const data = defaultSettingsData();
        writeSettingsStore(data);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("settings:pick-download-folder", async () => {
    try {
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: "Choose download folder",
            properties: ["openDirectory", "createDirectory"]
        });

        if (canceled || !filePaths || !filePaths.length) {
            return { success: false, canceled: true };
        }

        const current = readSettingsStore();
        current.downloads = current.downloads || {};
        current.downloads.defaultFolder = filePaths[0];
        writeSettingsStore(current);

        return { success: true, data: current, path: filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("settings:get-about", async () => {
    try {
        return {
            success: true,
            data: {
                mbrowserVersion: (() => {
                    try {
                        return require(path.join(__dirname, "package.json")).version;
                    } catch (e) {
                        return app.getVersion();
                    }
                })(),
                stableCommit: getStableCommit(),
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node,
                platform: process.platform,
                arch: process.arch,
                osRelease: os.release(),
                osType: os.type()
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("settings:clear-privacy", async (event, target) => {
    try {
        const type = String(target || "");
        const results = {};

        if (type === "history" || type === "all") {
            const history = readHistoryStore();
            history.entries = [];
            writeHistoryStore(history);
            results.history = true;
        }

        if (type === "cache" || type === "all") {
            await session.defaultSession.clearCache();
            results.cache = true;
        }

        if (type === "cookies" || type === "all") {
            await session.defaultSession.clearStorageData({
                storages: ["cookies", "localstorage", "indexdb", "shadercache", "websql", "serviceworkers"]
            });
            results.cookies = true;
        }

        if (type === "downloads" || type === "all") {
            const downloads = readDownloadsStore();
            downloads.items = [];
            writeDownloadsStore(downloads);
            broadcastDownloads("downloads:changed", { data: downloads });
            results.downloads = true;
        }

        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/* ===================== Downloads ===================== */

const activeDownloadItems = new Map();
const downloadSpeedState = new Map();
let downloadsCache = null;
let downloadsPersistTimer = null;

function downloadsFilePath() {
    return path.join(app.getPath("userData"), "downloads.json");
}

function defaultDownloadsData() {
    return {
        version: 1,
        items: []
    };
}

function readDownloadsStore() {
    if (downloadsCache) return downloadsCache;

    const filePath = downloadsFilePath();

    if (!fs.existsSync(filePath)) {
        const data = defaultDownloadsData();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        downloadsCache = data;
        return data;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw || "{}");
        if (!Array.isArray(data.items)) {
            downloadsCache = defaultDownloadsData();
            return downloadsCache;
        }
        downloadsCache = { version: data.version || 1, items: data.items };
        return downloadsCache;
    } catch (error) {
        console.error("[DOWNLOADS] Failed to read store:", error);
        downloadsCache = defaultDownloadsData();
        return downloadsCache;
    }
}

function writeDownloadsStore(data) {
    const filePath = downloadsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    downloadsCache = data;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function scheduleDownloadsPersist() {
    if (downloadsPersistTimer) return;
    downloadsPersistTimer = setTimeout(() => {
        downloadsPersistTimer = null;
        if (downloadsCache) writeDownloadsStore(downloadsCache);
    }, 750);
}

function flushDownloadsPersist() {
    if (downloadsPersistTimer) {
        clearTimeout(downloadsPersistTimer);
        downloadsPersistTimer = null;
    }
    if (downloadsCache) writeDownloadsStore(downloadsCache);
}

function createDownloadId() {
    return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function broadcastDownloads(channel, payload) {
    BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    });
}

function upsertDownloadRecord(record, options = {}) {
    const persist = options.persist !== false;
    const notify = options.notify !== false;
    const data = readDownloadsStore();
    const index = data.items.findIndex((item) => item.id === record.id);
    if (index >= 0) data.items[index] = { ...data.items[index], ...record };
    else data.items.unshift(record);
    downloadsCache = data;
    if (persist) writeDownloadsStore(data);
    else scheduleDownloadsPersist();
    if (notify) broadcastDownloads("downloads:changed", { data, item: record });
    return data;
}

function getUniqueSavePath(targetPath) {
    if (!fs.existsSync(targetPath)) return targetPath;
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    const dir = path.dirname(targetPath);
    let i = 1;
    let candidate = path.join(dir, `${base} (${i})${ext}`);
    while (fs.existsSync(candidate)) {
        i += 1;
        candidate = path.join(dir, `${base} (${i})${ext}`);
    }
    return candidate;
}

function showDownloadNotification(title, body) {
    try {
        const settings = readSettingsStore();
        if (!(settings.downloads && settings.downloads.showNotifications)) return;
        if (!Notification.isSupported()) return;
        const note = new Notification({ title, body, silent: false });
        note.show();
    } catch (error) {
        console.error("[DOWNLOADS] Notification failed:", error);
    }
}

function mapDoneState(state) {
    if (state === "completed") return "completed";
    if (state === "cancelled") return "cancelled";
    if (state === "interrupted") return "interrupted";
    return "failed";
}

function attachDownloadItemHandlers(id, item) {
    activeDownloadItems.set(id, item);
    downloadSpeedState.set(id, {
        lastBytes: 0,
        lastTime: Date.now(),
        speed: 0
    });

    item.on("updated", (_event, state) => {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const now = Date.now();
        const speedInfo = downloadSpeedState.get(id) || {
            lastBytes: received,
            lastTime: now,
            speed: 0
        };

        const elapsed = Math.max(1, now - speedInfo.lastTime);
        if (elapsed >= 500) {
            const delta = Math.max(0, received - speedInfo.lastBytes);
            speedInfo.speed = Math.round((delta * 1000) / elapsed);
            speedInfo.lastBytes = received;
            speedInfo.lastTime = now;
            downloadSpeedState.set(id, speedInfo);
        }

        const progress = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        let status = "downloading";
        if (state === "interrupted") status = item.isPaused() ? "paused" : "interrupted";
        else if (item.isPaused()) status = "paused";

        const patch = {
            id,
            downloadedBytes: received,
            fileSize: total,
            progress,
            status,
            speed: speedInfo.speed || 0
        };

        upsertDownloadRecord(patch, { persist: false, notify: false });
        broadcastDownloads("downloads:progress", patch);
    });

    item.once("done", (_event, state) => {
        activeDownloadItems.delete(id);
        downloadSpeedState.delete(id);

        const received = item.getReceivedBytes();
        const total = item.getTotalBytes() || received;
        const status = mapDoneState(state);
        const savePath = item.getSavePath();
        const patch = {
            id,
            status,
            downloadedBytes: received,
            fileSize: total,
            progress: status === "completed" ? 100 : (total > 0 ? Math.round((received / total) * 100) : 0),
            endTime: Date.now(),
            targetPath: savePath,
            fileName: path.basename(savePath || item.getFilename() || "download"),
            speed: 0,
            errorMessage: status === "completed" ? "" : (status === "cancelled" ? "Cancelled by user" : "Download failed")
        };

        flushDownloadsPersist();
        upsertDownloadRecord(patch);

        if (status === "completed") {
            showDownloadNotification("Download complete", patch.fileName);
            try {
                const settings = readSettingsStore();
                if (settings.downloads && settings.downloads.autoOpenDownloads && savePath) {
                    shell.openPath(savePath);
                }
            } catch (e) {
                /* ignore auto-open errors */
            }
        } else if (status === "failed" || status === "interrupted") {
            showDownloadNotification("Download failed", patch.fileName);
        }
    });
}

function registerBrowserDownloadCapture() {
    session.defaultSession.on("will-download", async (event, item, webContents) => {
        try {
            const settings = readSettingsStore();
            const dl = settings.downloads || {};
            const folder = (dl.defaultFolder && String(dl.defaultFolder).trim())
                ? dl.defaultFolder
                : app.getPath("downloads");

            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
            }

            const suggested = item.getFilename() || "download";
            const id = createDownloadId();
            let sourcePage = "";
            try {
                sourcePage = webContents && !webContents.isDestroyed() ? (webContents.getURL() || "") : "";
            } catch (e) {
                sourcePage = "";
            }

            const record = {
                id,
                fileName: suggested,
                url: item.getURL(),
                targetPath: "",
                fileSize: item.getTotalBytes() || 0,
                downloadedBytes: 0,
                progress: 0,
                mimeType: item.getMimeType() || "",
                startTime: Date.now(),
                endTime: null,
                status: "downloading",
                sourcePage,
                errorMessage: "",
                speed: 0
            };

            if (dl.askBeforeDownload) {
                item.pause();
                const win = BrowserWindow.fromWebContents(webContents) || BrowserWindow.getFocusedWindow();
                const { canceled, filePath } = await dialog.showSaveDialog(win, {
                    title: "Save Download",
                    defaultPath: path.join(folder, suggested)
                });

                if (canceled || !filePath) {
                    item.cancel();
                    record.status = "cancelled";
                    record.endTime = Date.now();
                    record.errorMessage = "Cancelled by user";
                    upsertDownloadRecord(record);
                    return;
                }

                item.setSavePath(filePath);
                record.targetPath = filePath;
                record.fileName = path.basename(filePath);
                upsertDownloadRecord(record);
                showDownloadNotification("Download started", record.fileName);
                attachDownloadItemHandlers(id, item);
                item.resume();
                return;
            }

            const savePath = getUniqueSavePath(path.join(folder, suggested));
            item.setSavePath(savePath);
            record.targetPath = savePath;
            record.fileName = path.basename(savePath);
            upsertDownloadRecord(record);
            showDownloadNotification("Download started", record.fileName);
            attachDownloadItemHandlers(id, item);
        } catch (error) {
            console.error("[DOWNLOADS] will-download error:", error);
            try { item.cancel(); } catch (e) { /* ignore */ }
        }
    });
}

ipcMain.handle("downloads:get", async () => {
    try {
        return { success: true, data: readDownloadsStore() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:delete", async (event, payload) => {
    try {
        const ids = Array.isArray(payload)
            ? payload
            : Array.isArray(payload && payload.ids)
              ? payload.ids
              : payload && payload.id
                ? [payload.id]
                : [];
        if (!ids.length) return { success: false, error: "No download ids provided." };

        const idSet = new Set(ids.map(String));
        const data = readDownloadsStore();
        const before = data.items.length;
        data.items = data.items.filter((item) => !idSet.has(String(item.id)));
        writeDownloadsStore(data);
        broadcastDownloads("downloads:changed", { data });
        return { success: true, data, deletedCount: before - data.items.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:clear", async (event, scope) => {
    try {
        const data = readDownloadsStore();
        const before = data.items.length;
        if (scope === "completed") {
            data.items = data.items.filter((item) => item.status !== "completed");
        } else {
            data.items = [];
        }
        writeDownloadsStore(data);
        broadcastDownloads("downloads:changed", { data });
        return { success: true, data, deletedCount: before - data.items.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:cancel", async (event, id) => {
    try {
        const item = activeDownloadItems.get(id);
        if (!item) return { success: false, error: "Active download not found." };
        item.cancel();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:pause", async (event, id) => {
    try {
        const item = activeDownloadItems.get(id);
        if (!item) return { success: false, error: "Active download not found." };
        if (typeof item.pause === "function") item.pause();
        upsertDownloadRecord({ id, status: "paused" });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:resume", async (event, id) => {
    try {
        const item = activeDownloadItems.get(id);
        if (!item) return { success: false, error: "Active download not found." };
        if (typeof item.resume === "function") item.resume();
        upsertDownloadRecord({ id, status: "downloading" });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:retry", async (event, id) => {
    try {
        const data = readDownloadsStore();
        const record = data.items.find((item) => item.id === id);
        if (!record || !record.url) {
            return { success: false, error: "Download record not found." };
        }
        session.defaultSession.downloadURL(record.url);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:open-file", async (event, id) => {
    try {
        const data = readDownloadsStore();
        const record = data.items.find((item) => item.id === id);
        if (!record || !record.targetPath) {
            return { success: false, error: "File path not available." };
        }
        if (!fs.existsSync(record.targetPath)) {
            return { success: false, error: "File no longer exists." };
        }
        const result = await shell.openPath(record.targetPath);
        if (result) return { success: false, error: result };
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("downloads:show-in-folder", async (event, id) => {
    try {
        const data = readDownloadsStore();
        const record = data.items.find((item) => item.id === id);
        if (!record || !record.targetPath) {
            return { success: false, error: "File path not available." };
        }
        if (!fs.existsSync(record.targetPath)) {
            return { success: false, error: "File no longer exists." };
        }
        shell.showItemInFolder(record.targetPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/* ===================== Passwords (Phase 1E-A Storage Engine) ===================== */

function passwordsFilePath() {
    return path.join(app.getPath("userData"), "passwords.json");
}

function createPasswordId() {
    return `pw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultPasswordsData() {
    return {
        version: 1,
        entries: []
    };
}

function readPasswordsStore() {
    const userDataPath = app.getPath("userData");

    if (isMigrationComplete(userDataPath)) {
        const session = getVaultSession();
        if (!session.isUnlocked()) {
            const error = new Error("Password vault is locked.");
            error.code = "VAULT_LOCKED";
            throw error;
        }
        const data = session.getDecryptedVault();
        if (!data) {
            const error = new Error("Password vault is unavailable.");
            error.code = "VAULT_UNAVAILABLE";
            throw error;
        }
        return deepClone(data);
    }

    const filePath = passwordsFilePath();

    if (!fs.existsSync(filePath)) {
        const data = defaultPasswordsData();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return data;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw || "{}");
        if (!Array.isArray(data.entries)) return defaultPasswordsData();
        return { version: data.version || 1, entries: data.entries };
    } catch (error) {
        console.error("[PASSWORDS] Failed to read store:", error);
        return defaultPasswordsData();
    }
}

async function writePasswordsStore(data) {
    const userDataPath = app.getPath("userData");

    if (isMigrationComplete(userDataPath)) {
        const session = getVaultSession();
        return session.persistDecryptedVault(data);
    }

    const filePath = passwordsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return data;
}

function derivePasswordOrigin(urlOrOrigin) {
    const raw = String(urlOrOrigin || "").trim();
    if (!raw || raw === "null") return "";
    try {
        const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : "https://" + raw;
        const parsed = new URL(withProto);
        if (parsed.protocol === "file:") return "file://";
        if (parsed.origin && parsed.origin !== "null") return parsed.origin;
        return "";
    } catch (e) {
        return raw;
    }
}

function normalizePasswordUrl(url) {
    return String(url || "").trim();
}

function isTrustedPasswordVaultSender(event) {
    if (!shellWebContents || !event || !event.sender) return false;
    return event.sender === shellWebContents;
}

function rejectUntrustedPasswordVaultSender(event) {
    if (isTrustedPasswordVaultSender(event)) return null;
    return { success: false, code: "UNTRUSTED_SENDER" };
}

ipcMain.handle("passwords:get", async (event) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        return { success: true, data: readPasswordsStore() };
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

ipcMain.handle("passwords:add", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const url = normalizePasswordUrl(payload && payload.url);
        const username = String((payload && payload.username) || "").trim();
        const password = String((payload && payload.password) || "");
        const notes = String((payload && payload.notes) || "").trim();
        const origin = derivePasswordOrigin((payload && payload.origin) || url);

        if (!url && !origin) {
            return { success: false, error: "Site URL or origin is required." };
        }
        if (!username) {
            return { success: false, error: "Username is required." };
        }

        const data = readPasswordsStore();
        const now = Date.now();
        const entry = {
            id: createPasswordId(),
            origin: origin || derivePasswordOrigin(url),
            url: url || origin,
            username,
            password,
            notes,
            createdAt: now,
            updatedAt: now
        };

        data.entries.unshift(entry);
        await writePasswordsStore(data);
        return { success: true, data, entry };
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

ipcMain.handle("passwords:update", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const id = payload && payload.id;
        if (!id) return { success: false, error: "Password id is required." };

        const data = readPasswordsStore();
        const entry = data.entries.find((item) => item.id === id);
        if (!entry) return { success: false, error: "Password entry not found." };

        if (payload.url !== undefined) entry.url = normalizePasswordUrl(payload.url);
        if (payload.username !== undefined) entry.username = String(payload.username || "").trim();
        if (payload.password !== undefined) entry.password = String(payload.password || "");
        if (payload.notes !== undefined) entry.notes = String(payload.notes || "").trim();
        if (payload.origin !== undefined) {
            entry.origin = derivePasswordOrigin(payload.origin);
        } else if (payload.url !== undefined) {
            entry.origin = derivePasswordOrigin(entry.url);
        }

        if (!entry.url && !entry.origin) {
            return { success: false, error: "Site URL or origin is required." };
        }
        if (!entry.username) {
            return { success: false, error: "Username is required." };
        }

        entry.updatedAt = Date.now();
        await writePasswordsStore(data);
        return { success: true, data, entry };
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

ipcMain.handle("passwords:delete", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const ids = Array.isArray(payload)
            ? payload
            : Array.isArray(payload && payload.ids)
              ? payload.ids
              : payload && payload.id
                ? [payload.id]
                : [];
        if (!ids.length) return { success: false, error: "No password ids provided." };

        const idSet = new Set(ids.map(String));
        const data = readPasswordsStore();
        const before = data.entries.length;
        data.entries = data.entries.filter((entry) => !idSet.has(String(entry.id)));
        await writePasswordsStore(data);
        return { success: true, data, deletedCount: before - data.entries.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("passwords:clear", async (event) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const data = readPasswordsStore();
        const deletedCount = data.entries.length;
        data.entries = [];
        await writePasswordsStore(data);
        return { success: true, data, deletedCount };
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

/* ===================== Vault Session (Phase 1E-D.2) ===================== */

let vaultSession = null;
let vaultAccess = null;

function getVaultSession() {
    if (!vaultSession) {
        vaultSession = createVaultSession({ userDataPath: app.getPath("userData") });
    }
    return vaultSession;
}

function getVaultAccess() {
    if (!vaultAccess) {
        vaultAccess = createVaultAccess({
            userDataPath: app.getPath("userData"),
            getSession: () => getVaultSession(),
            isMigrationComplete
        });
    }
    return vaultAccess;
}

ipcMain.handle("vault:status", async (event) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        return getVaultSession().getStatus();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("vault:setup", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const masterPassword = payload && payload.masterPassword;
        const confirmPassword = payload && payload.confirmPassword;
        return await getVaultSession().setup(masterPassword, confirmPassword);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("vault:unlock", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const masterPassword = payload && payload.masterPassword;
        return await getVaultSession().unlock(masterPassword);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("vault:lock", async (event) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        return getVaultSession().lock();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("vault:migrate", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const masterPassword = payload && payload.masterPassword;
        return await migrateVault({
            userDataPath: app.getPath("userData"),
            session: getVaultSession(),
            masterPassword
        });
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

ipcMain.handle("passwords:match", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const origin = payload && payload.origin;
        return getVaultAccess().matchCredentials(origin);
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

ipcMain.handle("passwords:retrieve-for-fill", async (event, payload) => {
    const rejected = rejectUntrustedPasswordVaultSender(event);
    if (rejected) return rejected;
    try {
        const id = payload && payload.id;
        const origin = payload && payload.origin;
        return getVaultAccess().retrieveCredentialForFill(id, origin);
    } catch (error) {
        return { success: false, error: error.message, code: error.code || undefined };
    }
});

ipcMain.handle("clipboard:write-text", async (_event, text) => {
    try {
        clipboard.writeText(String(text || ""));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/* ===================== Never-Save domains (Phase 1E-B) ===================== */

function neverSaveFilePath() {
    return path.join(app.getPath("userData"), "neverSave.json");
}

function defaultNeverSaveData() {
    return {
        version: 1,
        origins: []
    };
}

function readNeverSaveStore() {
    const filePath = neverSaveFilePath();

    if (!fs.existsSync(filePath)) {
        const data = defaultNeverSaveData();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return data;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw || "{}");
        if (!Array.isArray(data.origins)) return defaultNeverSaveData();
        return { version: data.version || 1, origins: data.origins.map(String) };
    } catch (error) {
        console.error("[NEVER-SAVE] Failed to read store:", error);
        return defaultNeverSaveData();
    }
}

function writeNeverSaveStore(data) {
    const filePath = neverSaveFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeNeverSaveOrigin(origin) {
    const raw = String(origin || "").trim();
    if (!raw || raw === "null") return "";
    try {
        const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : "https://" + raw;
        const parsed = new URL(withProto);
        if (parsed.protocol === "file:") return "file://";
        if (parsed.origin && parsed.origin !== "null") return parsed.origin;
        return "";
    } catch (e) {
        return raw.replace(/\/$/, "");
    }
}

ipcMain.handle("never-save:get", async () => {
    try {
        return { success: true, data: readNeverSaveStore() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("never-save:add", async (event, origin) => {
    try {
        const normalized = normalizeNeverSaveOrigin(origin);
        if (!normalized) return { success: false, error: "Origin is required." };

        const data = readNeverSaveStore();
        if (!data.origins.includes(normalized)) {
            data.origins.push(normalized);
            writeNeverSaveStore(data);
        }
        return { success: true, data, origin: normalized };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("never-save:remove", async (event, origin) => {
    try {
        const normalized = normalizeNeverSaveOrigin(origin);
        if (!normalized) return { success: false, error: "Origin is required." };

        const data = readNeverSaveStore();
        const before = data.origins.length;
        data.origins = data.origins.filter((item) => item !== normalized);
        writeNeverSaveStore(data);
        return { success: true, data, deletedCount: before - data.origins.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("never-save:has", async (event, origin) => {
    try {
        const normalized = normalizeNeverSaveOrigin(origin);
        const data = readNeverSaveStore();
        return { success: true, blocked: data.origins.includes(normalized), origin: normalized };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

