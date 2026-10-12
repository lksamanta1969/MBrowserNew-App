const path = require("path");

function resolveMDriveRoot(applicationRoot, { isPackaged = false, userDataPath } = {}) {
    if (!isPackaged) return path.join(applicationRoot, "mdrive");
    if (!userDataPath || !path.isAbsolute(userDataPath)) throw new Error("A valid user data path is required for installed MDrive.");
    return path.join(userDataPath, "mdrive");
}

module.exports = { resolveMDriveRoot };
