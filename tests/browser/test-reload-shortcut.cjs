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
