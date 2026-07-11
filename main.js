const { app, BrowserWindow, ipcMain } = require("electron");
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

ipcMain.handle("save-file", async (event, sourcePath) => {
  try {
   console.log("SOURCE:", sourcePath); 
    const fileName = path.basename(sourcePath);
    const targetDir = path.join(__dirname, "mdrive");
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