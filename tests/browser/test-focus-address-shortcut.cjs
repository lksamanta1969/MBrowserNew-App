const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  GUEST_TAB_SHORTCUT_CHANNEL,
  GUEST_FOCUS_ADDRESS_ACTION,
  resolveGuestShortcutAction,
  shouldForwardGuestTabShortcut,
  createGuestTabShortcutKeydownHandler
} = require(path.join(__dirname, "../../apps/browser/guest-tab-shortcut-policy.cjs"));

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
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: "l",
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
  const keydownListeners = [];
  const reloadCalls = [];
  const tabActions = [];
  const elements = options.elements || new Map();
  const urlInput = {
    value: "https://example.com/path",
    focusCount: 0,
    selectCount: 0,
    focus() {
      this.focusCount += 1;
    },
    select() {
      this.selectCount += 1;
    }
  };
  elements.set("url", urlInput);

  const BrowserTab = {
    reload() {
      reloadCalls.push(1);
    },
    init() {},
    back() {},
    forward() {},
    create() {
      tabActions.push("new-tab");
    },
    close() {
      tabActions.push("close-tab");
    },
    activateRelative() {
      tabActions.push("tab-cycle");
    },
    reopenClosed() {
      tabActions.push("reopen-tab");
    },
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
    urlInput,
    dispatchKey(event) {
      reloadCalls.length = 0;
      tabActions.length = 0;
      for (const fn of keydownListeners) fn(event);
      return { reloadCalls: reloadCalls.length, tabActions: tabActions.slice() };
    }
  };
}

test("isFocusAddressBarShortcut recognizes Ctrl+L only", () => {
  const S = loadShellTabShortcuts();
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "l" })), true);
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "L" })), true);
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "l", shiftKey: true })), false);
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "l", altKey: true })), false);
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "l", metaKey: true })), false);
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "l", ctrlKey: false })), false);
  assert.equal(S.isFocusAddressBarShortcut(keyEvent({ key: "L", ctrlKey: false })), false);
});

test("shell Ctrl+L focuses and selects #url without reload or tab actions", () => {
  const h = loadBrowserKeydownHarness();
  const ev = keyEvent({ key: "l", target: { tagName: "BODY" } });
  const result = h.dispatchKey(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(h.urlInput.focusCount, 1);
  assert.equal(h.urlInput.selectCount, 1);
  assert.equal(result.reloadCalls, 0);
  assert.equal(result.tabActions.length, 0);
});

test("Ctrl+L while already in #url still selects all", () => {
  const h = loadBrowserKeydownHarness();
  const ev = keyEvent({ key: "l", target: h.urlInput });
  h.dispatchKey(ev);
  assert.equal(h.urlInput.focusCount, 1);
  assert.equal(h.urlInput.selectCount, 1);
});

test("focus shortcut policy matches shell tab policy for url homesearch and blocked editables", () => {
  const S = loadShellTabShortcuts();
  const elements = new Map();
  const url = { tagName: "INPUT", id: "url" };
  const home = { tagName: "INPUT", id: "homesearch" };
  const bmSearch = { tagName: "INPUT", id: "bmSearchInput" };
  const textarea = { tagName: "TEXTAREA", id: "notes" };

  assert.equal(S.shellFocusAddressBarShortcutAllowed(keyEvent({ target: url }), (id) => elements.get(id)), true);
  assert.equal(S.shellFocusAddressBarShortcutAllowed(keyEvent({ target: home }), (id) => elements.get(id)), true);
  assert.equal(S.shellFocusAddressBarShortcutAllowed(keyEvent({ target: bmSearch }), (id) => elements.get(id)), false);
  assert.equal(S.shellFocusAddressBarShortcutAllowed(keyEvent({ target: textarea }), (id) => elements.get(id)), false);
});

function loadGuestWebpageShortcutHarness(options = {}) {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const reloadCalls = [];

  class Webview extends EventTarget {
    constructor() {
      super();
      this.style = { display: "none" };
      this._src = "";
      this.isConnected = true;
      this._ipcHandlers = [];
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
      reloadCalls.push(1);
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
  window.BrowserTab.init();
  window.BrowserTab.navigate("https://www.google.com/");
  urlInput.focusCount = 0;
  urlInput.selectCount = 0;
  reloadCalls.length = 0;

  const guestListeners = [];
  const guestDocument = {
    activeElement: options.guestActiveElement || { tagName: "BODY" },
    addEventListener(type, fn, capture) {
      if (type === "keydown") guestListeners.push({ fn, capture });
    }
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
  guestDocument.addEventListener("keydown", handler, true);

  return {
    urlInput,
    sent,
    reloadCalls,
    window,
    guestDocument,
    pressGuestKey(event) {
      const beforeTabs = window.BrowserTab.tabs.length;
      reloadCalls.length = 0;
      sent.length = 0;
      for (const entry of guestListeners) {
        if (entry.capture) entry.fn(event);
      }
      return { beforeTabs, afterTabs: window.BrowserTab.tabs.length };
    }
  };
}

test("guest webpage Ctrl+L uses browser-tab-shortcut and focuses shell #url", () => {
  const h = loadGuestWebpageShortcutHarness();
  const ev = keyEvent({
    key: "l",
    target: { tagName: "BODY" },
    stopPropagation() {
      this.stopped = true;
    }
  });
  const tabs = h.pressGuestKey(ev);
  assert.equal(resolveGuestShortcutAction(ev), GUEST_FOCUS_ADDRESS_ACTION);
  assert.equal(shouldForwardGuestTabShortcut(GUEST_FOCUS_ADDRESS_ACTION, false), true);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.stopped, true);
  assert.deepEqual(h.sent, [{ channel: GUEST_TAB_SHORTCUT_CHANNEL, action: "focus-address-bar" }]);
  assert.equal(h.urlInput.focusCount, 1);
  assert.equal(h.urlInput.selectCount, 1);
  assert.equal(h.urlInput.value, "https://www.google.com/");
  assert.equal(h.reloadCalls.length, 0);
  assert.equal(tabs.afterTabs, tabs.beforeTabs);
  assert.equal(h.window.BrowserTab.active.url, "https://www.google.com/");
});

test("guest page input Ctrl+L still forwards focus-address-bar", () => {
  const h = loadGuestWebpageShortcutHarness({
    guestActiveElement: { tagName: "INPUT", id: "q" }
  });
  const ev = keyEvent({
    key: "L",
    target: { tagName: "INPUT", id: "q" },
    stopPropagation() {}
  });
  h.pressGuestKey(ev);
  assert.equal(shouldForwardGuestTabShortcut("focus-address-bar", true), true);
  assert.deepEqual(h.sent, [{ channel: GUEST_TAB_SHORTCUT_CHANNEL, action: "focus-address-bar" }]);
  assert.equal(h.urlInput.focusCount, 1);
  assert.equal(h.urlInput.selectCount, 1);
  assert.equal(h.reloadCalls.length, 0);
});

test("guest Ctrl+L stays focus-address-bar and F5/Ctrl+R resolve reload", () => {
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "l" })), "focus-address-bar");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "t" })), "new-tab");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "w" })), "close-tab");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "Tab" })), "next-tab");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "Tab", shiftKey: true })), "prev-tab");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "T", shiftKey: true })), "reopen-tab");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "l", shiftKey: true })), null);
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "r" })), "reload");
  assert.equal(resolveGuestShortcutAction(keyEvent({ key: "F5", ctrlKey: false })), "reload");
});

test("open manager drops guest-forwarded Ctrl+L before focusing #url", () => {
  const elements = new Map([
    ["settingsManager", { classList: { contains: (c) => c === "open" } }]
  ]);
  const h = loadGuestWebpageShortcutHarness({ elements });
  const ev = keyEvent({
    key: "l",
    target: { tagName: "BODY" },
    stopPropagation() {}
  });
  h.pressGuestKey(ev);
  assert.equal(h.sent.length, 1);
  assert.equal(h.urlInput.focusCount, 0);
  assert.equal(h.urlInput.selectCount, 0);
  assert.equal(h.reloadCalls.length, 0);
});

test("inactive guest webview Ctrl+L does not focus the shell address bar", () => {
  const h = loadGuestWebpageShortcutHarness();
  const bt = h.window.BrowserTab;
  bt.create(null, false);
  const background = bt.tabs[0];
  assert.notEqual(background, bt.active);
  h.urlInput.focusCount = 0;
  h.urlInput.selectCount = 0;
  background.view.dispatchShortcutIpc(GUEST_TAB_SHORTCUT_CHANNEL, "focus-address-bar");
  assert.equal(h.urlInput.focusCount, 0);
  assert.equal(h.urlInput.selectCount, 0);
});

test("manager-open blocks Ctrl+L focus shortcut", () => {
  const elements = new Map([
    ["settingsManager", { classList: { contains: (c) => c === "open" } }]
  ]);
  const h = loadBrowserKeydownHarness({ elements });
  const ev = keyEvent({ key: "l", target: { tagName: "BODY" } });
  const result = h.dispatchKey(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.equal(h.urlInput.focusCount, 0);
  assert.equal(h.urlInput.selectCount, 0);
  assert.equal(result.reloadCalls, 0);
  assert.equal(result.tabActions.length, 0);
});
