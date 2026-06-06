const {
  app,
  BrowserWindow,
  ipcMain
} = require("electron");

const fs = require("fs");
const path = require("path");

function createWindow() {

const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "MBrowser",
    icon: __dirname + "/mbrowser-logo.ico",

 webPreferences: {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: true,
  webSecurity: false,
  allowRunningInsecureContent: true
} 
 
});

win.loadFile("index.html");

win.webContents.on("did-finish-load", () => {
    win.webContents.focus();
});

win.setMenuBarVisibility(false)
}

app.whenReady().then(() => {

createWindow();

});
ipcMain.handle(
  "save-file",
  async (event, sourcePath) => {

    const fileName =
      path.basename(sourcePath);

    const destPath =
      path.join(
        __dirname,
        "mdrive",
        fileName
      );

      
    fs.copyFileSync(
      sourcePath,
      destPath
    );

    return {
      success: true,
      fileName,
      path: destPath
    };
});