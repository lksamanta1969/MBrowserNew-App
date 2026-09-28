/* Tab pages stay mounted: switching tabs never reloads their contents. */
const CLOSED_TAB_STACK_MAX = 10; /* Recently closed tabs kept for Ctrl+Shift+T. */

class BrowserTabs {
    constructor() {
        this.tabs = [];
        this.active = null;
        this.nextId = 1;
        this.closedTabs = [];
    }

    captureClosedSnapshot(tab) {
        if (tab === this.active) {
            tab.address = document.getElementById("url").value;
            tab.homeSearch = document.getElementById("homesearch").value;
        }
        return {
            home: !!tab.home,
            url: tab.url || "",
            address: tab.address || "",
            title: tab.title || "New Tab",
            homeSearch: tab.homeSearch || ""
        };
    }

    pushClosedSnapshot(snapshot) {
        this.closedTabs.push(snapshot);
        if (this.closedTabs.length > CLOSED_TAB_STACK_MAX) this.closedTabs.shift();
    }

    reopenClosed() {
        const snapshot = this.closedTabs.pop();
        if (!snapshot) return false;
        const tab = this.create(null, false);
        if (snapshot.home) {
            tab.homeSearch = snapshot.homeSearch;
            tab.title = snapshot.title || "New Tab";
            document.getElementById("homesearch").value = snapshot.homeSearch;
            this.paint(tab);
        } else {
            const url = snapshot.url || snapshot.address;
            tab.title = snapshot.title || url || "New Tab";
            if (url) this.navigate(url);
            else this.paint(tab);
        }
        return true;
    }

    init() {
        if (this.active) return;
        this.strip = document.getElementById("tabList");
        this.mount = document.getElementById("browser-webview-mount");
        this.create(document.getElementById("browser"), false);
    }

    create(view = null, applySettings = true) {
        if (!view) view = document.createElement("webview");
        const tab = { id: this.nextId++, view, home: true, title: "New Tab", url: "", address: "", homeSearch: "" };
        const item = document.createElement("div");
        item.className = "tab";
        const select = document.createElement("button");
        select.className = "tab-select";
        select.setAttribute("role", "tab");
        select.addEventListener("click", () => this.activate(tab));
        const close = document.createElement("button");
        close.className = "tab-close";
        close.textContent = "×";
        close.addEventListener("click", () => this.close(tab));
        item.append(select, close);
        Object.assign(tab, { item, select, close });
        this.tabs.push(tab);
        this.strip.appendChild(item);
        this.bind(tab);
        if (!view.isConnected) this.mount.before(view);
        this.activate(tab);
        if (applySettings && window.Settings) Settings.handleNewTab();
        this.paint(tab);
        document.getElementById("url").focus();
        return tab;
    }

    paint(tab) {
        const title = tab.home ? "New Tab" : (tab.title || tab.url || "New Tab");
        tab.select.textContent = title;
        tab.select.title = title;
        tab.select.setAttribute("aria-selected", String(tab === this.active));
        tab.close.setAttribute("aria-label", "Close " + title);
        tab.item.classList.toggle("active", tab === this.active);
    }

    activate(tab) {
        if (!this.tabs.includes(tab) || this.active === tab) return;
        const previous = this.active;
        if (previous) {
            previous.address = document.getElementById("url").value;
            previous.homeSearch = document.getElementById("homesearch").value;
            window.Autofill?.deactivate();
            window.LoginDetection?.deactivate();
            previous.view.removeAttribute("id");
            previous.view.style.display = "none";
        }
        this.active = tab;
        tab.view.id = "browser";
        window.onHomePage = tab.home;
        tab.view.style.display = tab.home ? "none" : "flex";
        document.getElementById("home").style.display = tab.home ? "block" : "none";
        document.getElementById("url").value = tab.address;
        document.getElementById("homesearch").value = tab.homeSearch;
        this.tabs.forEach(t => this.paint(t));
        window.Autofill?.activate(tab.view);
        window.LoginDetection?.activate(tab.view);
        window.Bookmarks?.onPageChanged();
        this.applyZoom(tab);
    }

    applyZoom(tab) {
        try {
            if (window.Settings) tab.view.setZoomFactor(Number(Settings.get("general.defaultZoom", 100)) / 100);
        } catch (_) { /* The guest may not be ready yet. */ }
    }

    showHome() {
        const tab = this.active;
        if (!tab) return;
        window.Autofill?.deactivate();
        window.LoginDetection?.deactivate();
        tab.home = true;
        tab.address = "";
        window.onHomePage = true;
        tab.view.style.display = "none";
        document.getElementById("home").style.display = "block";
        document.getElementById("url").value = "";
        window.Bookmarks?.onPageChanged();
        this.paint(tab);
    }

    navigate(url) {
        const tab = this.active;
        if (!tab) return;
        tab.home = false;
        tab.url = url;
        tab.address = url === "about:blank" ? "" : url;
        tab.title = tab.address || "New Tab";
        window.onHomePage = false;
        document.getElementById("home").style.display = "none";
        document.getElementById("url").value = tab.address;
        tab.view.style.display = "flex";
        window.Autofill?.deactivate();
        window.LoginDetection?.deactivate();
        tab.view.src = url;
        window.Autofill?.activate(tab.view);
        window.LoginDetection?.activate(tab.view);
        window.Bookmarks?.onPageChanged();
        this.paint(tab);
    }

    back() {
        const tab = this.active;
        if (!tab || tab.home) return;
        try {
            if (tab.view.canGoBack()) tab.view.goBack();
            else this.showHome();
        } catch (_) { /* Guest not ready. */ }
    }

    forward() {
        const tab = this.active;
        if (!tab) return;
        if (tab.home && tab.url) {
            tab.home = false;
            window.onHomePage = false;
            tab.address = tab.url === "about:blank" ? "" : tab.url;
            document.getElementById("home").style.display = "none";
            document.getElementById("url").value = tab.address;
            tab.view.style.display = "flex";
            window.Autofill?.activate(tab.view);
            window.LoginDetection?.activate(tab.view);
            window.Bookmarks?.onPageChanged();
            this.paint(tab);
            return;
        }
        try { if (tab.view.canGoForward()) tab.view.goForward(); } catch (_) { /* Guest not ready. */ }
    }

    reload() {
        try { if (this.active && !this.active.home) this.active.view.reload(); } catch (_) { /* Guest not ready. */ }
    }

    close(tab) {
        const index = this.tabs.indexOf(tab);
        if (index < 0) return;
        this.pushClosedSnapshot(this.captureClosedSnapshot(tab));
        if (this.tabs.length === 1) this.create(null, false);
        else if (tab === this.active) this.activate(this.tabs[index + 1] || this.tabs[index - 1]);
        window.Autofill?.dispose(tab.view);
        window.LoginDetection?.dispose(tab.view);
        this.tabs.splice(this.tabs.indexOf(tab), 1);
        tab.view.remove();
        tab.item.remove();
    }

    bind(tab) {
        const update = event => {
            if (event.isMainFrame === false || !this.tabs.includes(tab)) return;
            tab.url = event.url || tab.url;
            if (!tab.home) tab.address = tab.url === "about:blank" ? "" : tab.url;
            if (tab === this.active && !tab.home) {
                document.getElementById("url").value = tab.address;
                window.Bookmarks?.onPageChanged();
            }
            let title = tab.url;
            try { title = tab.view.getTitle() || title; } catch (_) { /* Guest not ready. */ }
            tab.title = title === "about:blank" ? "New Tab" : title;
            window.History?.recordVisit(tab.url, tab.title);
            this.paint(tab);
        };
        tab.view.addEventListener("did-navigate", update);
        tab.view.addEventListener("did-navigate-in-page", update);
        tab.view.addEventListener("page-title-updated", event => {
            if (!this.tabs.includes(tab)) return;
            tab.title = event.title === "about:blank" ? "New Tab" : event.title;
            if (tab.url && event.title) window.History?.updateTitle(tab.url, event.title);
            if (tab === this.active) window.Bookmarks?.onPageChanged();
            this.paint(tab);
        });
        tab.view.addEventListener("dom-ready", () => this.applyZoom(tab));
    }
}

window.BrowserTab = new BrowserTabs();

/* Each guest owns its credential state; only the active guest owns shell prompts. */
window.createTabService = function (factory) {
    const instances = new Map();
    let ready = false;
    let active = null;
    const service = {
        async init() {
            ready = true;
            await service.activate(document.getElementById("browser"));
        },
        async activate(view) {
            if (!ready || !view) return;
            let instance = instances.get(view);
            if (!instance) {
                instance = factory(view, () => active === instance && view.isConnected && !window.onHomePage);
                instances.set(view, instance);
                instance.ready = instance.init();
            }
            active = instance;
            await instance.ready;
            if (active === instance) instance.resume();
        },
        deactivate() { if (active) active.suspend(); active = null; },
        dispose(view) {
            const instance = instances.get(view);
            if (!instance) return;
            if (active === instance) service.deactivate();
            instance.dispose();
            instances.delete(view);
        }
    };
    return new Proxy(service, {
        get(target, key) {
            if (key in target) return target[key];
            if (key === "refreshSettingsFlags" || key === "refreshNeverSave") {
                return () => Promise.all([...instances.values()].map(instance => instance[key]()));
            }
            const value = active && active[key];
            return typeof value === "function" ? value.bind(active) : value;
        }
    });
};
