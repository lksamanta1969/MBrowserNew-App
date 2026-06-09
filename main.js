const { app, BrowserWindow, ipcMain } = require("electron");
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
      nodeIntegration: false,
      webviewTag: true,         // Required for your <webview> browser component
      webSecurity: true,        // FIXED: Enforces standard web security rules
      allowRunningInsecureContent: false // FIXED: Prevents loading insecure HTTP assets
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
ipcMain.handle("save-file", async (event, sourcePath) => {
  try {
    const fileName = path.basename(sourcePath);
    const targetDir = path.join(__dirname, "mdrive");
    const destPath = path.join(targetDir, fileName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    await fs.promises.copyFile(sourcePath, destPath);

    return { success: true, fileName, path: destPath };
  } catch (error) {
    console.error("File save error:", error);
    return { success: false, error: error.message };
  }
});