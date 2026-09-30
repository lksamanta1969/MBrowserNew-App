const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  shouldForwardGuestTabShortcut,
  GUEST_TAB_SHORTCUT_ACTIONS
} = require(path.join(__dirname, "../../apps/browser/guest-tab-shortcut-policy.cjs"));

test("guest non-editable forwards all tab shortcuts", () => {
  for (const action of GUEST_TAB_SHORTCUT_ACTIONS) {
    assert.equal(shouldForwardGuestTabShortcut(action, false), true);
  }
});

test("guest editable INPUT forwards new-tab and reopen-tab only", () => {
  assert.equal(shouldForwardGuestTabShortcut("new-tab", true), true);
  assert.equal(shouldForwardGuestTabShortcut("reopen-tab", true), true);
  assert.equal(shouldForwardGuestTabShortcut("close-tab", true), false);
  assert.equal(shouldForwardGuestTabShortcut("next-tab", true), false);
  assert.equal(shouldForwardGuestTabShortcut("prev-tab", true), false);
});

test("guest editable TEXTAREA and contentEditable match INPUT policy for Ctrl+T", () => {
  assert.equal(shouldForwardGuestTabShortcut("new-tab", true), true);
  assert.equal(shouldForwardGuestTabShortcut("close-tab", true), false);
});

test("guest editable still allows Ctrl+Shift+T reopen-tab", () => {
  assert.equal(shouldForwardGuestTabShortcut("reopen-tab", true), true);
});

test("unknown guest action is rejected", () => {
  assert.equal(shouldForwardGuestTabShortcut("evil-action", false), false);
  assert.equal(shouldForwardGuestTabShortcut("evil-action", true), false);
});

test("repeated new-tab has no tab-count guard in policy", () => {
  for (let i = 0; i < 10; i += 1) {
    assert.equal(shouldForwardGuestTabShortcut("new-tab", true), true);
    assert.equal(shouldForwardGuestTabShortcut("new-tab", false), true);
  }
});
