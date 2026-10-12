const express = require("express");
const path = require("path");

function mountPublicAssets(app, applicationRoot) {
    app.use("/apps", express.static(path.join(applicationRoot, "apps"), { dotfiles: "deny" }));
    app.get("/mbrowser-logo.ico", (_req, res) => {
        res.sendFile(path.join(applicationRoot, "mbrowser-logo.ico"));
    });
}

module.exports = { mountPublicAssets };
