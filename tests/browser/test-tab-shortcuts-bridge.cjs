const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadShellTabShortcuts() {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const window = {};
  const ctx = vm.createContext({ window, document: { getElementById: () => null } });
  vm.runInContext(fs.readFileSync(path.join(root, "ShellTabShortcuts.js"), "utf8"), ctx);
  return window.ShellTabShortcuts;
}

function keyEvent(overrides) {
  return {
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: "t",
    target: { tagName: "BODY" },
    ...overrides
  };
}

test("resolveKeyboardShortcutAction maps Ctrl+T/W/Tab/Shift+Tab/Shift+T", () => {
  const S = loadShellTabShortcuts();
  assert.equal(S.resolveKeyboardShortcutAction(keyEvent({ key: "t" })), "new-tab");
  assert.equal(S.resolveKeyboardShortcutAction(keyEvent({ key: "T", shiftKey: true })), "reopen-tab");
  assert.equal(S.resolveKeyboardShortcutAction(keyEvent({ key: "w" })), "close-tab");
  assert.equal(S.resolveKeyboardShortcutAction(keyEvent({ key: "Tab" })), "next-tab");
  assert.equal(S.resolveKeyboardShortcutAction(keyEvent({ key: "Tab", shiftKey: true })), "prev-tab");
  assert.equal(S.resolveKeyboardShortcutAction(keyEvent({ key: "t", ctrlKey: false })), null);
});

test("prev-tab and next-tab dispatch activateRelative with correct delta", () => {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const relativeCalls = [];
  const BrowserTab = {
    activateRelative(delta) {
      relativeCalls.push(delta);
    },
    init() {},
    back() {},
    forward() {},
    reload() {},
    create() {},
    close() {},
    reopenClosed() {},
    active: null
  };
  const document = { getElementById: () => null, addEventListener() {} };
  const window = { onHomePage: true, BrowserTab, document };
  const ctx = vm.createContext({ window, document, BrowserTab, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, "browser.js"), "utf8"), ctx);
  ctx.executeBrowserTabShortcutAction("prev-tab");
  ctx.executeBrowserTabShortcutAction("next-tab");
  assert.deepEqual(relativeCalls, [-1, 1]);
});

test("URL and home search inputs allow shell tab shortcuts", () => {
  const S = loadShellTabShortcuts();
  const url = { tagName: "INPUT", id: "url" };
  const home = { tagName: "INPUT", id: "homesearch" };
  const elements = new Map();
  assert.ok(S.shellTabShortcutAllowed(keyEvent({ target: url }), (id) => elements.get(id)));
  assert.ok(S.shellTabShortcutAllowed(keyEvent({ target: home }), (id) => elements.get(id)));
});

test("ordinary shell editable fields remain blocked", () => {
  const S = loadShellTabShortcuts();
  const bmSearch = { tagName: "INPUT", id: "bmSearchInput" };
  const textarea = { tagName: "TEXTAREA", id: "notes" };
  const elements = new Map();
  assert.equal(S.shellTabShortcutAllowed(keyEvent({ target: bmSearch }), (id) => elements.get(id)), false);
  assert.equal(S.shellTabShortcutAllowed(keyEvent({ target: textarea }), (id) => elements.get(id)), false);
  assert.equal(
    S.shellTabShortcutAllowed(keyEvent({ target: { tagName: "DIV", isContentEditable: true } }), (id) => elements.get(id)),
    false
  );
});

test("open managers block shell and guest-forward shortcuts", () => {
  const S = loadShellTabShortcuts();
  const elements = new Map([
    ["settingsManager", { classList: { contains: (c) => c === "open" } }]
  ]);
  const lookup = (id) => elements.get(id);
  assert.equal(S.shellTabShortcutAllowed(keyEvent({ target: { tagName: "BODY" } }), lookup), false);
  assert.equal(S.shellTabShortcutAllowedForGuestForward(lookup), false);
});

test("unknown forwarded actions are rejected", () => {
  const S = loadShellTabShortcuts();
  assert.equal(S.isValidAction("new-tab"), true);
  assert.equal(S.isValidAction("evil-action"), false);
  assert.equal(S.shouldAcceptGuestShortcut("evil-action", () => null), false);
  assert.equal(S.shouldAcceptGuestShortcut("new-tab", () => null), true);
});
