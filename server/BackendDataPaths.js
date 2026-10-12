const fs = require("fs");
const path = require("path");

function getBackendDataPaths(applicationRoot, env = process.env) {
    const override = env.MBROWSER_DATA_DIR;
    if (override && !path.isAbsolute(override)) throw new Error("MBROWSER_DATA_DIR must be an absolute path.");
    const directory = override || applicationRoot;
    if (override) fs.mkdirSync(directory, { recursive: true });
    return {
        directory,
        envFile: path.join(directory, ".env"),
        mail: path.join(directory, "maildb.json"),
        pay: path.join(directory, "mpaydb.json"),
        notes: path.join(directory, "mnotes.json"),
        tube: path.join(directory, "mtubedb.json")
    };
}

module.exports = { getBackendDataPaths };
