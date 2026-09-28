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

  const window = { onHomePage: true, Autofill: { deactivate() {}, activate() {}, dispose(v) { disposed.add(v); } }, LoginDetection: { deactivate() {}, activate() {}, dispose(v) { disposed.add(v); } } };
  const ctx = vm.createContext({ window, document, console, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(fs.readFileSync(path.join(root, "BrowserTab.js"), "utf8"), ctx);

  window.BrowserTab.init();
  return { window, webviews, disposed, elements };
}

test("A close one URL tab then reopen restores URL", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/page-a");
  const closedView = bt.active.view;
  bt.close(bt.active);
  assert.equal(bt.closedTabs.length, 1);
  assert.ok(h.disposed.has(closedView));
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/page-a");
  assert.notEqual(bt.active.view, closedView);
});

test("B close multiple tabs then reopen is LIFO", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/first");
  bt.activate(bt.tabs[1]);
  bt.navigate("https://example.com/second");
  bt.activate(bt.tabs[2]);
  bt.navigate("https://example.com/third");
  bt.close(bt.tabs[2]);
  bt.close(bt.tabs[1]);
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/second");
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/third");
});

test("C empty closed stack is safe no-op", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  const count = bt.tabs.length;
  assert.equal(bt.reopenClosed(), false);
  assert.equal(bt.tabs.length, count);
});

test("D close home tab then reopen restores home state", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  h.elements.get("homesearch").value = "keep-me";
  bt.active.homeSearch = "keep-me";
  bt.close(bt.active);
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.home, true);
  assert.equal(h.window.onHomePage, true);
  assert.equal(h.elements.get("homesearch").value, "keep-me");
});

test("E close last tab keeps replacement usable then reopen restores closed tab", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/only");
  bt.close(bt.active);
  assert.equal(bt.tabs.length, 1);
  assert.equal(bt.active.home, true);
  assert.equal(bt.closedTabs.length, 1);
  assert.ok(bt.reopenClosed());
  assert.equal(bt.tabs.length, 2);
  assert.equal(bt.active.url, "https://example.com/only");
});

test("F reopened tab uses fresh webview not disposed guest", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.navigate("https://example.com/fresh");
  const oldView = bt.active.view;
  bt.close(bt.active);
  assert.ok(h.disposed.has(oldView));
  assert.ok(bt.reopenClosed());
  assert.notEqual(bt.active.view, oldView);
  assert.equal(bt.active.view.isConnected, true);
  assert.equal(oldView.isConnected, false);
});

test("G repeated close and reopen does not cross-bind tab state", () => {
  const h = setup();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  bt.activate(bt.tabs[0]);
  bt.navigate("https://example.com/a");
  bt.activate(bt.tabs[1]);
  bt.navigate("https://example.com/b");
  const viewA = bt.tabs[0].view;
  const viewB = bt.tabs[1].view;
  bt.close(bt.tabs[1]);
  bt.close(bt.tabs[0]);
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/a");
  assert.notEqual(bt.active.view, viewA);
  assert.ok(bt.reopenClosed());
  assert.equal(bt.active.url, "https://example.com/b");
  assert.notEqual(bt.active.view, viewB);
});
