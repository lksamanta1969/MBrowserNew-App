const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2] || "release/win-unpacked/resources/app");
for (const name of ["main.js", "preload.js", "index.html", "server.js", "server/BackendProcess.js", "server/BackendDataPaths.js", "server/PublicAssets.js", "node_modules/nodemailer/package.json"]) {
    assert.ok(fs.existsSync(path.join(root, name)), "Missing runtime file: " + name);
}
for (const name of [".env", "maildb.json", "mpaydb.json", "mnotes.json", "mtubedb.json", "passwords.json", "bookmarks.json", "history.json", "downloads.json", "mdrive", "tests", "test-fixtures", ".git"]) {
    assert.equal(fs.existsSync(path.join(root, name)), false, "Private or development data included: " + name);
}
const allowed = new Set(["main.js", "preload.js", "index.html", "server.js", "mbrowser-logo.ico", "package.json", "apps", "server", "vault", "node_modules"]);
for (const name of fs.readdirSync(root)) assert.ok(allowed.has(name), "Unexpected package root entry: " + name);
console.log("PASS: required runtime files present; private root data and development fixtures excluded");
