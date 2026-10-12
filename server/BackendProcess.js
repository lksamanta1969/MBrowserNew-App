const { spawn } = require("child_process");

function createBackendProcess({ executable, script, cwd, env = process.env, spawnProcess = spawn, onError = () => {} }) {
    let child = null;
    return {
        start() {
            if (child) return child;
            const current = spawnProcess(executable, [script], {
                cwd,
                env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
                shell: false,
                windowsHide: true
            });
            child = current;
            current.on("error", (error) => {
                if (child === current) child = null;
                onError(error);
            });
            current.on("exit", () => {
                if (child === current) child = null;
            });
            return current;
        },
        stop() {
            const current = child;
            child = null;
            if (current && current.exitCode == null && current.signalCode == null) current.kill();
        }
    };
}

module.exports = { createBackendProcess };
