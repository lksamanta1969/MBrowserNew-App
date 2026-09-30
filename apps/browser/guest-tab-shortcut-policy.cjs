/* Guest webview tab-shortcut policy (shared by preload + tests). */
const GUEST_TAB_SHORTCUT_ACTIONS = new Set(["new-tab", "close-tab", "next-tab", "prev-tab", "reopen-tab"]);

const BROWSER_LEVEL_WHEN_EDITABLE = new Set(["new-tab", "reopen-tab"]);

function shouldForwardGuestTabShortcut(action, guestFocusEditable) {
  if (!GUEST_TAB_SHORTCUT_ACTIONS.has(action)) return false;
  if (!guestFocusEditable) return true;
  return BROWSER_LEVEL_WHEN_EDITABLE.has(action);
}

module.exports = {
  GUEST_TAB_SHORTCUT_ACTIONS,
  BROWSER_LEVEL_WHEN_EDITABLE,
  shouldForwardGuestTabShortcut
};
