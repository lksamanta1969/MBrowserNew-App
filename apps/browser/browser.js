
const browser = document.getElementById("browser");
let onHomePage = true;
let lastPageBeforeHome = "";

function goBack() {
    if (onHomePage) return;

    let canBack = false;
    try {
        canBack = !!(browser && browser.canGoBack && browser.canGoBack());
    } catch (e) {
        canBack = false;
    }

    if (canBack) {
        browser.goBack();
    } else {
        try {
            lastPageBeforeHome = browser.getURL();
        } catch (e) {
            lastPageBeforeHome = document.getElementById("url").value || lastPageBeforeHome;
        }

        browser.style.display = "none";
        document.getElementById("home").style.display = "block";
        document.getElementById("url").value = "";
        onHomePage = true;
        if (window.Bookmarks) Bookmarks.onPageChanged();
    }
}

function goForward() {

    if (onHomePage && lastPageBeforeHome) {
        document.getElementById("home").style.display = "none";
        browser.style.display = "flex";
        browser.src = lastPageBeforeHome;
        onHomePage = false;
        if (window.Bookmarks) Bookmarks.onPageChanged();
        return;
    }

    try {
        if (!onHomePage && browser.canGoForward()) {
            browser.goForward();
        }
    } catch (e) {
        /* webview may not be ready */
    }
}

function refreshPage() {
    if (onHomePage) return;
    try {
        if (browser && browser.reload) browser.reload();
    } catch (e) {
        console.warn("refreshPage failed:", e);
    }
}

function openApp(appName) {
    toggleApps();
    document.getElementById("home").style.display = "none";
    browser.style.display = "flex";
    onHomePage = false;

    const appUrl = "http://localhost:3000/apps/" + appName + "/index.html";

    browser.src = appUrl;

    console.log("OPENING:", appUrl);
    if (window.Bookmarks) Bookmarks.onPageChanged();
}

function loadSite(){
    let url = document.getElementById("url").value.trim();
    if(url === "") return;
    if(!url.startsWith("http://") && !url.startsWith("https://")){
        if(url.includes(".")){ url = "https://" + url; }
        else {
            url = window.Settings
                ? Settings.buildSearchUrl(url)
                : ("https://www.google.com/search?q=" + encodeURIComponent(url));
        }
    }
    document.getElementById("home").style.display = "none";
    browser.style.display = "flex";
    browser.src = url;
    onHomePage = false;
    if (window.Bookmarks) Bookmarks.onPageChanged();
}

browser.addEventListener("did-navigate", (e) => {
    document.getElementById("url").value = e.url;
    if (window.Bookmarks) Bookmarks.onPageChanged();
    if (window.History) {
        let title = e.url;
        try {
            if (browser.getTitle) title = browser.getTitle() || e.url;
        } catch (err) {
            /* webview may not be ready */
        }
        History.recordVisit(e.url, title);
    }
});

browser.addEventListener("did-navigate-in-page", (e) => {
    if (e && e.url) {
        document.getElementById("url").value = e.url;
        if (window.Bookmarks) Bookmarks.onPageChanged();
        if (window.History) {
            let title = e.url;
            try {
                if (browser.getTitle) title = browser.getTitle() || e.url;
            } catch (err) {
                /* ignore */
            }
            History.recordVisit(e.url, title);
        }
    }
});

browser.addEventListener("page-title-updated", (e) => {
    if (window.Bookmarks) Bookmarks.onPageChanged();
    if (window.History) {
        let url = "";
        try {
            url = browser.getURL() || document.getElementById("url").value || "";
        } catch (err) {
            url = document.getElementById("url").value || "";
        }
        const title = (e && e.title) || "";
        if (url && title) History.updateTitle(url, title);
    }
});

function newTab(){
    if (window.Settings) {
        const behavior = Settings.handleNewTab();
        if (behavior === "homepage" || behavior === "blank") {
            if (window.Bookmarks) Bookmarks.onPageChanged();
            return;
        }
    }

    browser.src = "";
    browser.style.display = "none";
    document.getElementById("url").value = "";
    document.getElementById("home").style.display = "block";
    document.getElementById("homesearch").value = "";
    onHomePage = true;
    if (window.Bookmarks) Bookmarks.onPageChanged();
}

function homeSearch(){
    document.getElementById("url").value = document.getElementById("homesearch").value;
    loadSite();
}

function toggleApps() {
    const menu = document.getElementById("appsMenu");

    if (menu.style.display === "flex") {
        menu.style.display = "none";
    } else {
        menu.style.display = "flex";
    }
}

window.onload = async function(){
    document.getElementById("appsMenu").style.display = "none";
    setTimeout(() => { document.getElementById("url").focus(); }, 300);
    if (window.Settings) {
        await Settings.init();
    }
    if (window.Bookmarks) {
        Bookmarks.init();
    }
    if (window.History) {
        History.init();
    }
}
document.addEventListener("DOMContentLoaded", () => {
    if (window.BrowserTab) {
        window.BrowserTab.init();
    }
});
