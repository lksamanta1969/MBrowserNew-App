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

function failChrome(elements) {
  const btn = elements.get("navReloadBtn");
  if (!btn) return { failed: false, ariaInvalid: undefined, loading: false, ariaBusy: undefined };
  return {
    failed: btn.classList.contains("load-failed"),
    ariaInvalid: btn.getAttribute("aria-invalid"),
    loading: btn.classList.contains("loading"),
    ariaBusy: btn.getAttribute("aria-busy")
  };
}

function setup(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const includeReload = options.includeReload !== false;

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
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
  elements.set("tabList", { appendChild() {} });
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
  return { window, elements };
}

test("1 New/Home tab failure state and chrome are off", () => {
  const h = setup();
  const state = failChrome(h.elements);
  assert.equal(h.window.BrowserTab.active.home, true);
  assert.equal(h.window.BrowserTab.active.loadFailed, false);
  assert.equal(state.failed, false);
  assert.equal(state.ariaInvalid, "false");
});

test("2 main-frame did-fail-load errorCode -2 sets failure and clears spinner", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/fail");
  bt.active.view.emitLoad("did-start-loading");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  const state = failChrome(h.elements);
  assert.equal(bt.active.loadFailed, true);
  assert.equal(bt.active.loading, false);
  assert.equal(state.failed, true);
  assert.equal(state.ariaInvalid, "true");
  assert.equal(state.loading, false);
  assert.equal(state.ariaBusy, "false");
});

test("3 did-fail-load errorCode -3 does not set loadFailed", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/abort");
  bt.active.view.emitLoad("did-start-loading");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -3 });
  const state = failChrome(h.elements);
  assert.equal(bt.active.loadFailed, false);
  assert.equal(bt.active.loading, false);
  assert.equal(state.failed, false);
  assert.equal(state.ariaInvalid, "false");
});

test("4 subframe did-fail-load does not set loadFailed", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/frame");
  bt.active.view.emitLoad("did-start-loading");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2, isMainFrame: false });
  const state = failChrome(h.elements);
  assert.equal(bt.active.loadFailed, false);
  assert.equal(bt.active.loading, true);
  assert.equal(state.failed, false);
  assert.equal(state.ariaInvalid, "false");
});

test("5 next main-frame did-start-loading clears failure and shows loading chrome", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/retry");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  bt.active.view.emitLoad("did-start-loading");
  const state = failChrome(h.elements);
  assert.equal(bt.active.loadFailed, false);
  assert.equal(bt.active.loading, true);
  assert.equal(state.failed, false);
  assert.equal(state.ariaInvalid, "false");
  assert.equal(state.loading, true);
  assert.equal(state.ariaBusy, "true");
});

test("6 did-stop-loading does not erase a recorded failure", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/fail-then-stop");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  bt.active.view.emitLoad("did-stop-loading");
  const state = failChrome(h.elements);
  assert.equal(bt.active.loadFailed, true);
  assert.equal(bt.active.loading, false);
  assert.equal(state.failed, true);
  assert.equal(state.ariaInvalid, "true");
  assert.equal(state.loading, false);
});

test("7 switching from failed Tab A to idle Tab B hides failure chrome", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/a");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  const tabA = bt.tabs[0];
  bt.create(null, false);
  const state = failChrome(h.elements);
  assert.equal(tabA.loadFailed, true);
  assert.equal(bt.active.loadFailed, false);
  assert.equal(state.failed, false);
  assert.equal(state.ariaInvalid, "false");
});

test("8 switching back to failed Tab A shows failure chrome", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/a");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  const tabA = bt.tabs[0];
  bt.create(null, false);
  bt.activate(tabA);
  const state = failChrome(h.elements);
  assert.equal(bt.active, tabA);
  assert.equal(tabA.loadFailed, true);
  assert.equal(state.failed, true);
  assert.equal(state.ariaInvalid, "true");
});

test("9 showHome clears loadFailed and failure chrome", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/home");
  bt.active.view.emitLoad("did-start-loading");
  bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
  bt.showHome();
  const state = failChrome(h.elements);
  assert.equal(bt.active.home, true);
  assert.equal(bt.active.loadFailed, false);
  assert.equal(bt.active.loading, false);
  assert.equal(state.failed, false);
  assert.equal(state.ariaInvalid, "false");
  assert.equal(state.loading, false);
  assert.equal(state.ariaBusy, "false");
});

test("10 missing navReloadBtn must not throw", () => {
  const h = setup({ includeReload: false });
  const bt = h.window.BrowserTab;
  assert.doesNotThrow(() => bt.syncFailureChrome());
  assert.doesNotThrow(() => {
    bt.navigate("https://example.com/x");
    bt.active.view.emitLoad("did-fail-load", { errorCode: -2 });
    bt.active.view.emitLoad("did-start-loading");
    bt.active.view.emitLoad("did-stop-loading");
    bt.showHome();
  });
  assert.equal(bt.active.loadFailed, false);
});
