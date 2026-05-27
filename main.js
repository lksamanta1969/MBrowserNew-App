const { app, BrowserWindow } = require("electron");

function createWindow() {

const win = new BrowserWindow({

width: 1400,
height: 900,
icon: __dirname + "/mbrowser-logo.ico",
webPreferences: {

nodeIntegration: true,
contextIsolation: false,
webviewTag: true

}

});

win.loadFile("index.html");

win.setMenuBarVisibility(false)
}

app.whenReady().then(() => {

createWindow();

});