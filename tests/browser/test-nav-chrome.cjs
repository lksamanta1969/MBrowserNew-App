const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeNavButton() {
  const attrs = {};
  return {
    disabled: false,
    attrs,
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name];
    }
  };
}

function chrome(elements) {
  return {
    back: !elements.get("navBackBtn").disabled,
    forward: !elements.get("navForwardBtn").disabled,
    reload: !elements.get("navReloadBtn").disabled
  };
}

function setup(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const webviews = [];
  const disposed = new Set();
  const includeButtons = options.includeButtons !== false;

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
      this._canGoBack = false;
      this._canGoForward = false;
      this.reloadCount = 0;
      webviews.push(this);
    }
    set src(value) {
      this._src = value;
      this.url = value;
      queueMicrotask(() => {
        this.dispatchEvent(Object.assign(new Event("did-navigate"), { url: value, isMainFrame: true }));
      });
    }
    get src() {
      return this._src;
    }
    canGoBack() {
      return this._canGoBack;
    }
    canGoForward() {
      if (this._canGoForwardThrows) throw new Error("guest not ready");
      return this._canGoForward;
    }
    goBack() {
      this._canGoForward = true;
      this._canGoBack = false;
      this.dispatchEvent(Object.assign(new Event("did-navigate"), { url: this.url || this._src, isMainFrame: true }));
    }
    goForward() {
      this._canGoForward = false;
      this._canGoBack = true;
      this.dispatchEvent(Object.assign(new Event("did-navigate"), { url: this.url || this._src, isMainFrame: true }));
    }
    reload() {
      this.reloadCount += 1;
    }
    remove() {
      this.isConnected = false;
    }
    removeAttribute() {}
    setAttribute() {}
    setZoomFactor() {}
    getTitle() {
      return this._title || this._src || "title";
    }
  }

  const elements = new Map();
  const tabList = { appendChild() {} };
  elements.set("tabList", tabList);
  elements.set("browser-webview-mount", { before() {} });
  elements.set("url", { value: "", focus() {} });
  elements.set("homesearch", { value: "" });
  elements.set("home", { style: { display: "block" } });
  if (includeButtons) {
    elements.set("navBackBtn", makeNavButton());
    elements.set("navForwardBtn", makeNavButton());
    elements.set("navReloadBtn", makeNavButton());
  }

  const browser = new Webview();
  browser.id = "browser";
  elements.set("browser", browser);

  const document = {
    getElementById: (id) => elements.get(id),
    createElement(tag) {
      if (tag === "webview") return new Webview();
      const node = {
        className: "",
        textContent: "",
        style: {},
        setAttribute() {},
        addEventListener() {},
        append() {},
        remove() {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
      };
      return node;
    }
  };

  const window = {
    onHomePage: true,
    Autofill: { deactivate() {}, activate() {}, dispose(v) { disposed.add(v); } },
    LoginDetection: { deactivate() {}, activate() {}, dispose(v) { disposed.add(v); } }
  };
  const ctx = vm.createContext({ window, document, console, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(fs.readFileSync(path.join(root, "BrowserTab.js"), "utf8"), ctx);

  window.BrowserTab.init();
  return { window, webviews, disposed, elements };
}

test("1 New Tab disables Back Forward Reload", () => {
  const h = setup();
  const state = chrome(h.elements);
  assert.equal(h.window.BrowserTab.active.home, true);
  assert.equal(state.back, false);
  assert.equal(state.forward, false);
  assert.equal(state.reload, false);
});

test("2 after navigate Back and Reload enable and Forward reflects canGoForward", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/page");
  let state = chrome(h.elements);
  assert.equal(state.back, true);
  assert.equal(state.reload, true);
  assert.equal(state.forward, false);

  bt.active.view._canGoForward = true;
  bt.active.view.dispatchEvent(Object.assign(new Event("did-navigate"), {
    url: "https://example.com/page",
    isMainFrame: true
  }));
  state = chrome(h.elements);
  assert.equal(state.back, true);
  assert.equal(state.reload, true);
  assert.equal(state.forward, true);

  bt.active.view._canGoForward = false;
  bt.active.view.dispatchEvent(Object.assign(new Event("did-navigate-in-page"), {
    url: "https://example.com/page#hash",
    isMainFrame: true
  }));
  state = chrome(h.elements);
  assert.equal(state.forward, false);
});

test("3 back-to-home keeps tab.url and enables Forward only", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/kept");
  bt.active.view._canGoBack = false;
  bt.back();
  const state = chrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(bt.active.url, "https://example.com/kept");
  assert.equal(state.back, false);
  assert.equal(state.reload, false);
  assert.equal(state.forward, true);
});

test("4 forward-from-home restores page and enables Back Reload", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/restored");
  bt.active.view._canGoBack = false;
  bt.back();
  assert.equal(bt.active.home, true);
  bt.forward();
  const state = chrome(h.elements);
  assert.equal(bt.active.home, false);
  assert.equal(h.window.onHomePage, false);
  assert.equal(h.elements.get("home").style.display, "none");
  assert.equal(bt.active.view.style.display, "flex");
  assert.equal(h.elements.get("url").value, "https://example.com/restored");
  assert.equal(state.back, true);
  assert.equal(state.reload, true);
});

test("5 switching tabs updates chrome for the active tab only", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/tab-a");
  bt.active.view._canGoForward = true;
  bt.syncNavChrome();
  bt.create(null, false);
  let state = chrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(state.back, false);
  assert.equal(state.forward, false);
  assert.equal(state.reload, false);

  bt.activate(bt.tabs[0]);
  state = chrome(h.elements);
  assert.equal(bt.active.url, "https://example.com/tab-a");
  assert.equal(state.back, true);
  assert.equal(state.forward, true);
  assert.equal(state.reload, true);

  bt.activate(bt.tabs[1]);
  state = chrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(state.back, false);
  assert.equal(state.forward, false);
  assert.equal(state.reload, false);
});

test("6 reopened URL tab vs reopened home tab match restored chrome", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/reopen-url");
  bt.close(bt.active);
  assert.ok(bt.reopenClosed());
  let state = chrome(h.elements);
  assert.equal(bt.active.home, false);
  assert.equal(bt.active.url, "https://example.com/reopen-url");
  assert.equal(state.back, true);
  assert.equal(state.reload, true);
  assert.equal(state.forward, false);

  bt.create(null, false);
  h.elements.get("homesearch").value = "saved-query";
  bt.active.homeSearch = "saved-query";
  bt.close(bt.active);
  assert.ok(bt.reopenClosed());
  state = chrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(h.elements.get("homesearch").value, "saved-query");
  assert.equal(state.back, false);
  assert.equal(state.forward, false);
  assert.equal(state.reload, false);
});

test("7 missing navigation buttons do not throw", () => {
  const h = setup({ includeButtons: false });
  const bt = h.window.BrowserTab;
  assert.doesNotThrow(() => bt.syncNavChrome());
  assert.doesNotThrow(() => bt.navigate("https://example.com/missing"));
  assert.doesNotThrow(() => bt.reload());
  assert.doesNotThrow(() => bt.back());
  assert.doesNotThrow(() => bt.forward());
  assert.doesNotThrow(() => bt.reopenClosed());
});

test("canGoForward throw is treated as Forward disabled", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/throw");
  bt.active.view._canGoForwardThrows = true;
  assert.doesNotThrow(() => bt.syncNavChrome());
  const state = chrome(h.elements);
  assert.equal(state.back, true);
  assert.equal(state.reload, true);
  assert.equal(state.forward, false);
});
