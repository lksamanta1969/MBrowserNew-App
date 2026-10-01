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

function setup(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const webviews = [];
  const includeStop = options.includeStop !== false;

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
      this.reloadCount = 0;
      this.stopCount = 0;
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
    reload() {
      this.reloadCount += 1;
    }
    stop() {
      if (includeStop) this.stopCount += 1;
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
  elements.set("tabList", { appendChild() {} });
  elements.set("browser-webview-mount", { before() {} });
  elements.set("url", { value: "", focus() {} });
  elements.set("homesearch", { value: "" });
  elements.set("home", { style: { display: "block" } });
  elements.set("navBackBtn", makeNavButton());
  elements.set("navForwardBtn", makeNavButton());
  elements.set("navReloadBtn", makeNavButton());

  const browser = new Webview();
  browser.id = "browser";
  elements.set("browser", browser);

  const document = {
    getElementById: (id) => elements.get(id),
    createElement(tag) {
      if (tag === "webview") return new Webview();
      return {
        className: "",
        textContent: "",
        style: {},
        setAttribute() {},
        addEventListener() {},
        append() {},
        remove() {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
      };
    }
  };

  const window = {
    onHomePage: true,
    Autofill: { deactivate() {}, activate() {}, dispose() {} },
    LoginDetection: { deactivate() {}, activate() {}, dispose() {} }
  };
  const ctx = vm.createContext({ window, document, console, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(fs.readFileSync(path.join(root, "BrowserTab.js"), "utf8"), ctx);
  window.BrowserTab.init();
  return { window, webviews, elements };
}

function keyEvent(overrides) {
  return {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: "F5",
    target: { tagName: "BODY" },
    preventDefault() {
      this.defaultPrevented = true;
    },
    defaultPrevented: false,
    ...overrides
  };
}

test("1 idle non-home tab reload() calls reload not stop", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/idle");
  const view = bt.active.view;
  bt.reload();
  assert.equal(view.reloadCount, 1);
  assert.equal(view.stopCount, 0);
});

test("2 loading non-home tab reload() calls stop not reload", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/loading");
  const view = bt.active.view;
  view.emitLoad("did-start-loading");
  assert.equal(bt.active.loading, true);
  bt.reload();
  assert.equal(view.stopCount, 1);
  assert.equal(view.reloadCount, 0);
});

test("3 home tab reload does not call webview stop or reload", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  const view = bt.active.view;
  bt.reload();
  assert.equal(view.reloadCount, 0);
  assert.equal(view.stopCount, 0);
});

test("4 after loading becomes false reload works normally again", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/cycle");
  const view = bt.active.view;
  view.emitLoad("did-start-loading");
  bt.reload();
  assert.equal(view.stopCount, 1);
  assert.equal(view.reloadCount, 0);
  view.emitLoad("did-stop-loading");
  assert.equal(bt.active.loading, false);
  bt.reload();
  assert.equal(view.stopCount, 1);
  assert.equal(view.reloadCount, 1);
});

test("5 missing webview stop() does not throw and does not fallback to reload", () => {
  const h = setup({ includeStop: false });
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/no-stop");
  const view = bt.active.view;
  delete view.stop;
  view.emitLoad("did-start-loading");
  assert.doesNotThrow(() => bt.reload());
  assert.equal(view.reloadCount, 0);
});

test("6 F5 refreshPage path uses BrowserTab.reload stop behaviour while loading", () => {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const reloadCalls = [];
  const keydownListeners = [];
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/shortcut");
  const view = bt.active.view;
  view.emitLoad("did-start-loading");

  const BrowserTab = bt;
  const originalReload = BrowserTab.reload.bind(BrowserTab);
  BrowserTab.reload = function () {
    reloadCalls.push(1);
    return originalReload();
  };

  const window = h.window;
  window.BrowserTab = BrowserTab;
  const document = {
    getElementById: (id) => h.elements.get(id),
    addEventListener(type, fn) {
      if (type === "keydown") keydownListeners.push(fn);
    }
  };
  const ctx = vm.createContext({
    window,
    document,
    BrowserTab,
    console,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(root, "ShellTabShortcuts.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "browser.js"), "utf8"), ctx);

  const event = keyEvent({ key: "F5" });
  for (const fn of keydownListeners) fn(event);
  assert.equal(reloadCalls.length, 1);
  assert.equal(view.stopCount, 1);
  assert.equal(view.reloadCount, 0);
});
