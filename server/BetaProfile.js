const path = require("path");

function resolveBetaProfile({ isPackaged, appDataPath, currentUserDataPath }) {
    if (!isPackaged) return currentUserDataPath;
    if (!appDataPath || !path.isAbsolute(appDataPath)) throw new Error("A valid app data directory is required.");
    return path.join(appDataPath, "MBrowser Beta");
}

module.exports = { resolveBetaProfile };
