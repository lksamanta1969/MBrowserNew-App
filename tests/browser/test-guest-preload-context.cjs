const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { isTabWebviewGuestPreload } = require(path.join(
  __dirname,
  "../../apps/browser/guest-preload-context.cjs"
));
const {
  shouldForwardGuestTabShortcut
} = require(path.join(__dirname, "../../apps/browser/guest-tab-shortcut-policy.cjs"));

const SHELL_HREF = "file:///C:/Users/example/Desktop/MBrowser/index.html";
const GUEST_HREF = "https://example.com/mmail";

test("shell file:// context does NOT register as tab webview guest", () => {
  assert.equal(isTabWebviewGuestPreload(SHELL_HREF, true), false);
  assert.equal(isTabWebviewGuestPreload(SHELL_HREF, false), false);
});

test("shell Ctrl+T path is not swallowed by guest preload (no guest capture on file://)", () => {
  assert.equal(isTabWebviewGuestPreload(SHELL_HREF, true), false);
});

test("shell Ctrl+Shift+T is not swallowed by guest preload", () => {
  assert.equal(isTabWebviewGuestPreload(SHELL_HREF, true), false);
});

test("shell Ctrl+Tab is not swallowed by guest preload", () => {
  assert.equal(isTabWebviewGuestPreload(SHELL_HREF, true), false);
});

test("shell Ctrl+W is not swallowed by guest preload", () => {
  assert.equal(isTabWebviewGuestPreload(SHELL_HREF, true), false);
});

test("real tab webview http(s)/about guest is recognized when sendToHost exists", () => {
  assert.equal(isTabWebviewGuestPreload(GUEST_HREF, true), true);
  assert.equal(isTabWebviewGuestPreload("about:blank", true), true);
  assert.equal(isTabWebviewGuestPreload(GUEST_HREF, false), false);
});

test("shell vs guest policy: editable guest Ctrl+T and Ctrl+Shift+T forward", () => {
  assert.equal(shouldForwardGuestTabShortcut("new-tab", true), true);
  assert.equal(shouldForwardGuestTabShortcut("reopen-tab", true), true);
});

test("shell vs guest policy: editable guest Ctrl+W and Ctrl+Tab blocked", () => {
  assert.equal(shouldForwardGuestTabShortcut("close-tab", true), false);
  assert.equal(shouldForwardGuestTabShortcut("next-tab", true), false);
});

test("guest non-editable forwards close-tab and next-tab", () => {
  assert.equal(shouldForwardGuestTabShortcut("new-tab", false), true);
  assert.equal(shouldForwardGuestTabShortcut("close-tab", false), true);
  assert.equal(shouldForwardGuestTabShortcut("next-tab", false), true);
});

test("unknown guest action rejected", () => {
  assert.equal(shouldForwardGuestTabShortcut("evil-action", false), false);
  assert.equal(shouldForwardGuestTabShortcut("evil-action", true), false);
});
