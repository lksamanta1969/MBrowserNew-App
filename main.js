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
