
const browser = document.getElementById("browser");
let onHomePage = true;

function goBack() {
    if (onHomePage) return;

    if (browser.canGoBack()) {
        browser.goBack();
    } else {
        lastPageBeforeHome = browser.getURL();

        browser.style.display = "none";
        document.getElementById("home").style.display = "block";
        document.getElementById("url").value = "";
        onHomePage = true;
    }
}

function goForward() {

    if (onHomePage && lastPageBeforeHome) {
        document.getElementById("home").style.display = "none";
        browser.style.display = "flex";
        browser.src = lastPageBeforeHome;
        onHomePage = false;
        return;
    }

    if (!onHomePage && browser.canGoForward()) {
        browser.goForward();
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
}

function loadSite(){
    let url = document.getElementById("url").value.trim();
    if(url === "") return;
    if(!url.startsWith("http://") && !url.startsWith("https://")){
        if(url.includes(".")){ url = "https://" + url; }
        else { url = "https://www.google.com/search?q=" + encodeURIComponent(url); }
    }
    document.getElementById("home").style.display = "none";
    browser.style.display = "flex";
    browser.src = url;
    onHomePage = false;
}

browser.addEventListener("did-navigate", (e) => {
    document.getElementById("url").value = e.url;
});

function newTab(){
    browser.src = "";
    browser.style.display = "none";
    document.getElementById("url").value = "";
    document.getElementById("home").style.display = "block";
    document.getElementById("homesearch").value = "";
    onHomePage = true;
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

window.onload = function(){
    document.getElementById("appsMenu").style.display = "none";
    setTimeout(() => { document.getElementById("url").focus(); }, 300);
}
document.addEventListener("DOMContentLoaded", () => {
    if (window.BrowserTab) {
        window.BrowserTab.init();
    }
});