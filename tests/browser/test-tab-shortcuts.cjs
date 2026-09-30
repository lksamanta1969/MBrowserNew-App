const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const webviews = [];
  const disposed = new Set();

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
      this._ipcHandlers = [];
      webviews.push(this);
    }
    addEventListener(type, fn) {
      if (type === "ipc-message") this._ipcHandlers.push(fn);
      else super.addEventListener(type, fn);
    }
    dispatchShortcutIpc(action) {
      const event = { channel: "browser-tab-shortcut", args: [action] };
      for (const fn of this._ipcHandlers) fn(event);
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
  }

  const elements = new Map();
  const tabList = { appendChild() {} };
  elements.set("tabList", tabList);
  elements.set("browser-webview-mount", { before() {} });
  elements.set("url", { value: "", focus() {} });
  elements.set("homesearch", { value: "" });
  elements.set("home", { style: { display: "block" } });

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

test("activateRelative(+1) switches to next tab in strip order", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/a");
  bt.activate(bt.tabs[1]);
  bt.navigate("https://example.com/b");
  assert.equal(bt.active, bt.tabs[1]);
  assert.ok(bt.activateRelative(1));
  assert.equal(bt.active, bt.tabs[2]);
  assert.equal(bt.active.url, "");
});

test("activateRelative(-1) switches to previous tab in strip order", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/a");
  bt.activate(bt.tabs[2]);
  bt.navigate("https://example.com/c");
  assert.equal(bt.active, bt.tabs[2]);
  assert.ok(bt.activateRelative(-1));
  assert.equal(bt.active, bt.tabs[1]);
  assert.equal(bt.active.url, "");
});

test("activateRelative(-1) wraps from first tab to last", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/first");
  assert.equal(bt.active, bt.tabs[0]);
  assert.ok(bt.activateRelative(-1));
  assert.equal(bt.active, bt.tabs[1]);
  assert.equal(bt.active.url, "");
});

test("activateRelative(+1) wraps from last tab to first", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/first");
  bt.activate(bt.tabs[1]);
  bt.navigate("https://example.com/last");
  assert.equal(bt.active, bt.tabs[1]);
  assert.ok(bt.activateRelative(1));
  assert.equal(bt.active, bt.tabs[0]);
  assert.equal(bt.active.url, "https://example.com/first");
});

test("close active tab pushes stack and activates neighbor", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/keep");
  bt.activate(bt.tabs[1]);
  bt.navigate("https://example.com/close-me");
  const closing = bt.active;
  bt.close(closing);
  assert.equal(bt.tabs.length, 1);
  assert.equal(bt.closedTabs.length, 1);
  assert.equal(bt.active.url, "https://example.com/keep");
  assert.ok(h.disposed.has(closing.view));
});

test("close last remaining tab keeps one fresh home tab", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/only");
  bt.close(bt.active);
  assert.equal(bt.tabs.length, 1);
  assert.equal(bt.active.home, true);
  assert.equal(bt.closedTabs.length, 1);
});

test("background inactive webview shortcut ipc is ignored", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  let guestCalls = 0;
  h.window.applyBrowserTabShortcut = (action, source) => {
    if (source === "guest") guestCalls += 1;
  };
  bt.activate(bt.tabs[1]);
  bt.tabs[0].view.dispatchShortcutIpc("new-tab");
  assert.equal(guestCalls, 0);
  bt.tabs[1].view.dispatchShortcutIpc("new-tab");
  assert.equal(guestCalls, 1);
});

test("reopen after shortcut-style close remains LIFO", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/a");
  bt.activate(bt.tabs[1]);
  bt.navigate("https://example.com/b");
  bt.close(bt.tabs[1]);
  bt.close(bt.tabs[0]);
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/a");
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/b");
});
