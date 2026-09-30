window.onHomePage = true;

function goBack() { BrowserTab.back(); }
function goForward() { BrowserTab.forward(); }
function refreshPage() { BrowserTab.reload(); }

function openApp(appName) {
    document.getElementById("appsMenu").style.display = "none";
    BrowserTab.navigate("http://localhost:3000/apps/" + appName + "/index.html?v=" + Date.now());
}

function loadSite() {
    let url = document.getElementById("url").value.trim();
    if (!url) return;
    if (url === "mbrowser://home") {
        BrowserTab.showHome();
        return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://") && url !== "about:blank") {
        if (url.includes(".")) url = "https://" + url;
        else url = window.Settings ? Settings.buildSearchUrl(url) : "https://www.google.com/search?q=" + encodeURIComponent(url);
    }
    BrowserTab.navigate(url);
}

function newTab() { BrowserTab.create(); }
function homeSearch() {
    document.getElementById("url").value = document.getElementById("homesearch").value;
    loadSite();
}
function toggleApps() {
    const menu = document.getElementById("appsMenu");
    menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

function reopenClosedTab() {
    BrowserTab.reopenClosed();
}

function executeBrowserTabShortcutAction(action) {
    switch (action) {
        case "new-tab":
            newTab();
            return true;
        case "close-tab":
            if (BrowserTab.active) BrowserTab.close(BrowserTab.active);
            return true;
        case "next-tab":
            BrowserTab.activateRelative(1);
            return true;
        case "reopen-tab":
            reopenClosedTab();
            return true;
        default:
            return false;
    }
}

function applyBrowserTabShortcut(action, source) {
    const shortcuts = window.ShellTabShortcuts;
    if (!shortcuts || !shortcuts.isValidAction(action)) return;
    if (source === "guest") {
        if (!shortcuts.shellTabShortcutAllowedForGuestForward()) return;
    }
    executeBrowserTabShortcutAction(action);
}
window.applyBrowserTabShortcut = applyBrowserTabShortcut;

document.addEventListener("keydown", (event) => {
    const shortcuts = window.ShellTabShortcuts;
    if (!shortcuts) return;
    const action = shortcuts.resolveKeyboardShortcutAction(event);
    if (!action) return;
    if (!shortcuts.shellTabShortcutAllowed(event)) return;
    event.preventDefault();
    executeBrowserTabShortcutAction(action);
});

document.addEventListener("DOMContentLoaded", () => BrowserTab.init());
window.onload = async function () {
    BrowserTab.init();
    document.getElementById("appsMenu").style.display = "none";
    document.getElementById("url").focus();
    if (window.Settings) await Settings.init();
    if (window.Bookmarks) Bookmarks.init();
    if (window.History) History.init();
    if (window.Downloads) Downloads.init();
    if (window.Passwords) Passwords.init();
    if (window.LoginDetection) await LoginDetection.init();
    if (window.Autofill) await Autofill.init();
};
