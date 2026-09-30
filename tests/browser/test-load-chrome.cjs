const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeNavButton() {
  const attrs = {};
  const classes = new Set();
  return {
    disabled: false,
    attrs,
    classList: {
      toggle(cls, force) {
        if (force === true) classes.add(cls);
        else if (force === false) classes.delete(cls);
        else if (classes.has(cls)) classes.delete(cls);
        else classes.add(cls);
      },
      contains(cls) {
        return classes.has(cls);
      }
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name];
    }
  };
}

function loadChrome(elements) {
  const btn = elements.get("navReloadBtn");
  if (!btn) return { loading: false, ariaBusy: undefined };
  return {
    loading: btn.classList.contains("loading"),
    ariaBusy: btn.getAttribute("aria-busy")
  };
}

function setup(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const webviews = [];
  const disposed = new Set();
  const includeReload = options.includeReload !== false;

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
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
    remove() {
      this.isConnected = false;
    }
    removeAttribute() {}
    setAttribute() {}
    setZoomFactor() {}
    getTitle() {
      return this._title || this._src || "title";
    }
    emitLoad(eventName, extra) {
      this.dispatchEvent(Object.assign(new Event(eventName), { isMainFrame: true, ...(extra || {}) }));
    }
  }

  const elements = new Map();
  const tabList = { appendChild() {} };
  elements.set("tabList", tabList);
  elements.set("browser-webview-mount", { before() {} });
  elements.set("url", { value: "", focus() {} });
  elements.set("homesearch", { value: "" });
  elements.set("home", { style: { display: "block" } });
  elements.set("navBackBtn", makeNavButton());
  elements.set("navForwardBtn", makeNavButton());
  if (includeReload) elements.set("navReloadBtn", makeNavButton());

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
  return { window, webviews, elements };
}

test("1 New/Home tab loading indicator OFF", () => {
  const h = setup();
  const state = loadChrome(h.elements);
  assert.equal(h.window.BrowserTab.active.home, true);
  assert.equal(h.window.BrowserTab.active.loading, false);
  assert.equal(state.loading, false);
  assert.equal(state.ariaBusy, "false");
});

test("2 did-start-loading turns active tab loading indicator ON", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/load");
  bt.active.view.emitLoad("did-start-loading");
  const state = loadChrome(h.elements);
  assert.equal(bt.active.loading, true);
  assert.equal(state.loading, true);
  assert.equal(state.ariaBusy, "true");
});

test("3 did-stop-loading turns indicator OFF", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/load");
  bt.active.view.emitLoad("did-start-loading");
  bt.active.view.emitLoad("did-stop-loading");
  const state = loadChrome(h.elements);
  assert.equal(bt.active.loading, false);
  assert.equal(state.loading, false);
  assert.equal(state.ariaBusy, "false");
});

test("4 did-fail-load turns indicator OFF", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/fail");
  bt.active.view.emitLoad("did-start-loading");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  const state = loadChrome(h.elements);
  assert.equal(bt.active.loading, false);
  assert.equal(state.loading, false);
});

test("5 Tab A loading and Tab B idle shows OFF on B", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/a");
  bt.active.view.emitLoad("did-start-loading");
  bt.create(null, false);
  const state = loadChrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(state.loading, false);
  assert.equal(bt.tabs[0].loading, true);
});

test("6 switching back to still-loading Tab A shows indicator ON", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/a");
  bt.active.view.emitLoad("did-start-loading");
  const tabA = bt.tabs[0];
  bt.create(null, false);
  bt.activate(tabA);
  const state = loadChrome(h.elements);
  assert.equal(bt.active, tabA);
  assert.equal(state.loading, true);
  assert.equal(state.ariaBusy, "true");
});

test("7 showHome clears loading state and chrome", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/home");
  bt.active.view.emitLoad("did-start-loading");
  bt.showHome();
  const state = loadChrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(bt.active.loading, false);
  assert.equal(state.loading, false);
  assert.equal(state.ariaBusy, "false");
});

test("8 missing navReloadBtn must not throw", () => {
  const h = setup({ includeReload: false });
  const bt = h.window.BrowserTab;
  assert.doesNotThrow(() => bt.syncLoadChrome());
  assert.doesNotThrow(() => {
    bt.navigate("https://example.com/x");
    bt.active.view.emitLoad("did-start-loading");
    bt.active.view.emitLoad("did-stop-loading");
  });
  assert.doesNotThrow(() => bt.showHome());
});
