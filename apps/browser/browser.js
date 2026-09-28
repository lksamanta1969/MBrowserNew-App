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

function shellTabShortcutAllowed(event) {
    const target = event.target;
    if (
        target &&
        (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
    ) {
        return false;
    }
    const isOpen = (id) => {
        const el = document.getElementById(id);
        return !!(el && el.classList.contains("open"));
    };
    if (
        isOpen("settingsManager") ||
        isOpen("bookmarkManager") ||
        isOpen("historyManager") ||
        isOpen("downloadsManager") ||
        isOpen("passwordManager") ||
        isOpen("ldSavePrompt") ||
        isOpen("ldUpdatePrompt") ||
        isOpen("afOfferPrompt")
    ) {
        return false;
    }
    return true;
}

document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (!shellTabShortcutAllowed(event)) return;
    if (event.key === "T" || event.key === "t") {
        if (event.shiftKey) {
            event.preventDefault();
            reopenClosedTab();
        }
    }
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
