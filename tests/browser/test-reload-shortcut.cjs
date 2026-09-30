const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadShellTabShortcuts(getElementById) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const window = {};
  const document = { getElementById: getElementById || (() => null) };
  const ctx = vm.createContext({ window, document });
  vm.runInContext(fs.readFileSync(path.join(root, "ShellTabShortcuts.js"), "utf8"), ctx);
  return window.ShellTabShortcuts;
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

function loadBrowserKeydownHarness(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const reloadCalls = [];
  const keydownListeners = [];
  const elements = options.elements || new Map();
  const BrowserTab = {
    reload() {
      reloadCalls.push(1);
    },
    init() {},
    back() {},
    forward() {},
    create() {},
    close() {},
    activateRelative() {},
    reopenClosed() {},
    active: null
  };
  const window = { onHomePage: true, BrowserTab };
  const document = {
    getElementById: (id) => elements.get(id),
    addEventListener(type, fn) {
      if (type === "keydown") keydownListeners.push(fn);
    }
  };
  const ctx = vm.createContext({ window, document, BrowserTab, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, "ShellTabShortcuts.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "browser.js"), "utf8"), ctx);
  return {
    S: window.ShellTabShortcuts,
    dispatchKey(event) {
      reloadCalls.length = 0;
      for (const fn of keydownListeners) fn(event);
      return reloadCalls.length;
    }
  };
}

test("isReloadKeyboardShortcut recognizes F5 and Ctrl+R only", () => {
  const S = loadShellTabShortcuts();
  assert.equal(S.isReloadKeyboardShortcut(keyEvent({ key: "F5" })), true);
  assert.equal(
    S.isReloadKeyboardShortcut(keyEvent({ key: "r", ctrlKey: true })),
    true
  );
  assert.equal(
    S.isReloadKeyboardShortcut(keyEvent({ key: "R", ctrlKey: true })),
    true
  );
  assert.equal(S.isReloadKeyboardShortcut(keyEvent({ key: "r", ctrlKey: true, shiftKey: true })), false);
  assert.equal(S.isReloadKeyboardShortcut(keyEvent({ key: "r", ctrlKey: true, altKey: true })), false);
  assert.equal(S.isReloadKeyboardShortcut(keyEvent({ key: "r", ctrlKey: true, metaKey: true })), false);
  assert.equal(S.isReloadKeyboardShortcut(keyEvent({ key: "r" })), false);
  assert.equal(S.isReloadKeyboardShortcut(keyEvent({ key: "R" })), false);
});

test("shell keydown F5 and Ctrl+R call refreshPage reload path and preventDefault", () => {
  const h = loadBrowserKeydownHarness();
  const f5 = keyEvent({ key: "F5" });
  assert.equal(h.dispatchKey(f5), 1);
  assert.equal(f5.defaultPrevented, true);

  const ctrlR = keyEvent({ key: "r", ctrlKey: true });
  assert.equal(h.dispatchKey(ctrlR), 1);
  assert.equal(ctrlR.defaultPrevented, true);
});

test("Ctrl+Shift+R plain R and manager-open do not reload", () => {
  const h = loadBrowserKeydownHarness();
  const shiftR = keyEvent({ key: "r", ctrlKey: true, shiftKey: true });
  assert.equal(h.dispatchKey(shiftR), 0);
  assert.equal(shiftR.defaultPrevented, false);

  const plainR = keyEvent({ key: "r" });
  assert.equal(h.dispatchKey(plainR), 0);

  const elements = new Map([
    ["settingsManager", { classList: { contains: (c) => c === "open" } }]
  ]);
  const hMgr = loadBrowserKeydownHarness({ elements });
  const blocked = keyEvent({ key: "F5", target: { tagName: "BODY" } });
  assert.equal(hMgr.dispatchKey(blocked), 0);
  assert.equal(blocked.defaultPrevented, false);
});

test("reload shortcut policy matches shell tab policy for editables and url inputs", () => {
  const S = loadShellTabShortcuts();
  const elements = new Map();
  const url = { tagName: "INPUT", id: "url" };
  const home = { tagName: "INPUT", id: "homesearch" };
  const bmSearch = { tagName: "INPUT", id: "bmSearchInput" };
  const textarea = { tagName: "TEXTAREA", id: "notes" };

  assert.equal(S.shellReloadShortcutAllowed(keyEvent({ target: url }), (id) => elements.get(id)), true);
  assert.equal(S.shellReloadShortcutAllowed(keyEvent({ target: home }), (id) => elements.get(id)), true);
  assert.equal(S.shellReloadShortcutAllowed(keyEvent({ target: bmSearch }), (id) => elements.get(id)), false);
  assert.equal(S.shellReloadShortcutAllowed(keyEvent({ target: textarea }), (id) => elements.get(id)), false);
});

const {
  GUEST_TAB_SHORTCUT_CHANNEL,
  GUEST_RELOAD_ACTION,
  resolveGuestShortcutAction,
  shouldForwardGuestTabShortcut,
  createGuestTabShortcutKeydownHandler
} = require(path.join(__dirname, "../../apps/browser/guest-tab-shortcut-policy.cjs"));

function loadGuestReloadHarness(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
      this._ipcHandlers = [];
      this.reloadCount = 0;
    }
    addEventListener(type, fn) {
      if (type === "ipc-message") this._ipcHandlers.push(fn);
      else super.addEventListener(type, fn);
    }
    dispatchShortcutIpc(channel, action) {
      const event = { channel, args: [action] };
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
    canGoBack() {
      return false;
    }
    canGoForward() {
      return false;
    }
  }

  const urlInput = {
    value: "",
    focusCount: 0,
    selectCount: 0,
    focus() {
      this.focusCount += 1;
    },
    select() {
      this.selectCount += 1;
    }
  };
  const elements = options.elements || new Map();
  elements.set("url", urlInput);
  elements.set("homesearch", { value: "" });
  elements.set("home", { style: { display: "block" } });
  elements.set("tabList", { appendChild() {} });
  elements.set("browser-webview-mount", { before() {} });
  const browser = new Webview();
  browser.id = "browser";
  elements.set("browser", browser);

  const document = {
    getElementById: (id) => elements.get(id),
    addEventListener() {},
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
    Autofill: { deactivate() {}, activate() {} },
    LoginDetection: { deactivate() {}, activate() {} }
  };
  const ctx = vm.createContext({ window, document, console, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(fs.readFileSync(path.join(root, "ShellTabShortcuts.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "browser.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "BrowserTab.js"), "utf8"), ctx);
  ctx.BrowserTab = window.BrowserTab;
  window.BrowserTab.init();
  if (!options.stayHome) {
    window.BrowserTab.navigate("https://www.google.com/");
    window.BrowserTab.create(null, false);
    window.BrowserTab.navigate("https://www.google.com/search?q=mbrowser");
  }
  urlInput.focusCount = 0;
  urlInput.selectCount = 0;
  for (const tab of window.BrowserTab.tabs) tab.view.reloadCount = 0;

  const guestListeners = [];
  const guestDocument = {
    activeElement: options.guestActiveElement || { tagName: "BODY" }
  };
  const sent = [];
  const handler = createGuestTabShortcutKeydownHandler(
    (channel, action) => {
      sent.push({ channel, action });
      window.BrowserTab.active.view.dispatchShortcutIpc(channel, action);
    },
    () => {
      const el = guestDocument.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }
  );
  guestListeners.push({ fn: handler, capture: true });

  return {
    urlInput,
    sent,
    window,
    pressGuestKey(event) {
      const bt = window.BrowserTab;
      const active = bt.active;
      const tabCount = bt.tabs.length;
      sent.length = 0;
      for (const tab of bt.tabs) tab.view.reloadCount = 0;
      urlInput.focusCount = 0;
      urlInput.selectCount = 0;
      for (const entry of guestListeners) {
        if (entry.capture) entry.fn(event);
      }
      return {
        active,
        stillActive: bt.active === active,
        tabCount,
        tabCountAfter: bt.tabs.length
      };
    }
  };
}

function guestKey(overrides) {
  return keyEvent({
    stopPropagation() {
      this.stopped = true;
    },
    ...overrides
  });
}

test("guest webpage F5 reloads only the active tab through refreshPage", () => {
  const h = loadGuestReloadHarness();
  const active = h.window.BrowserTab.active;
  const background = h.window.BrowserTab.tabs[0];
  const ev = guestKey({ key: "F5", ctrlKey: false });
  const result = h.pressGuestKey(ev);
  assert.equal(resolveGuestShortcutAction(ev), GUEST_RELOAD_ACTION);
  assert.equal(shouldForwardGuestTabShortcut(GUEST_RELOAD_ACTION, false), true);
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(h.sent, [{ channel: GUEST_TAB_SHORTCUT_CHANNEL, action: "reload" }]);
  assert.equal(active.view.reloadCount, 1);
  assert.equal(background.view.reloadCount, 0);
  assert.equal(result.stillActive, true);
  assert.equal(result.tabCountAfter, result.tabCount);
  assert.equal(h.urlInput.focusCount, 0);
  assert.equal(h.urlInput.selectCount, 0);
  assert.equal(active.home, false);
});

test("guest webpage Ctrl+R reloads only the active tab through refreshPage", () => {
  const h = loadGuestReloadHarness({
    guestActiveElement: { tagName: "INPUT", id: "q" }
  });
  const active = h.window.BrowserTab.active;
  const background = h.window.BrowserTab.tabs[0];
  const ev = guestKey({ key: "r", ctrlKey: true, target: { tagName: "INPUT", id: "q" } });
  const result = h.pressGuestKey(ev);
  assert.equal(shouldForwardGuestTabShortcut(GUEST_RELOAD_ACTION, true), true);
  assert.deepEqual(h.sent, [{ channel: GUEST_TAB_SHORTCUT_CHANNEL, action: "reload" }]);
  assert.equal(active.view.reloadCount, 1);
  assert.equal(background.view.reloadCount, 0);
  assert.equal(result.stillActive, true);
  assert.equal(result.tabCountAfter, result.tabCount);
  assert.equal(h.urlInput.focusCount, 0);
  assert.equal(h.urlInput.selectCount, 0);
});

test("guest Ctrl+Shift+R Ctrl+Alt+R Meta+R and plain R do not reload", () => {
  const h = loadGuestReloadHarness();
  const cases = [
    guestKey({ key: "r", ctrlKey: true, shiftKey: true }),
    guestKey({ key: "R", ctrlKey: true, altKey: true }),
    guestKey({ key: "r", ctrlKey: true, metaKey: true }),
    guestKey({ key: "r", ctrlKey: false }),
    guestKey({ key: "R", ctrlKey: false, metaKey: true })
  ];
  for (const ev of cases) {
    const result = h.pressGuestKey(ev);
    assert.equal(resolveGuestShortcutAction(ev), null);
    assert.equal(h.sent.length, 0);
    assert.equal(ev.defaultPrevented, false);
    for (const tab of h.window.BrowserTab.tabs) {
      assert.equal(tab.view.reloadCount, 0);
    }
    assert.equal(result.stillActive, true);
    assert.equal(result.tabCountAfter, result.tabCount);
    assert.equal(h.urlInput.focusCount, 0);
  }
});

test("inactive guest webview reload ipc does not reload any tab", () => {
  const h = loadGuestReloadHarness();
  const background = h.window.BrowserTab.tabs[0];
  const active = h.window.BrowserTab.active;
  background.view.dispatchShortcutIpc(GUEST_TAB_SHORTCUT_CHANNEL, "reload");
  assert.equal(background.view.reloadCount, 0);
  assert.equal(active.view.reloadCount, 0);
  assert.equal(h.urlInput.focusCount, 0);
});

test("guest F5 on the home tab does not call view.reload", () => {
  const h = loadGuestReloadHarness({ stayHome: true });
  const active = h.window.BrowserTab.active;
  assert.equal(active.home, true);
  const ev = guestKey({ key: "F5", ctrlKey: false });
  const result = h.pressGuestKey(ev);
  assert.equal(h.sent[0].action, "reload");
  assert.equal(active.view.reloadCount, 0);
  assert.equal(result.stillActive, true);
  assert.equal(result.tabCountAfter, 1);
  assert.equal(active.home, true);
});
