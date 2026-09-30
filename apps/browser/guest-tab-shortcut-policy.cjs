/* Guest webview tab-shortcut policy (shared by preload + tests). */
const GUEST_TAB_SHORTCUT_CHANNEL = "browser-tab-shortcut";
const GUEST_TAB_SHORTCUT_ACTIONS = new Set(["new-tab", "close-tab", "next-tab", "prev-tab", "reopen-tab"]);
const GUEST_FOCUS_ADDRESS_ACTION = "focus-address-bar";
const GUEST_RELOAD_ACTION = "reload";

const BROWSER_LEVEL_WHEN_EDITABLE = new Set(["new-tab", "reopen-tab"]);

function shouldForwardGuestTabShortcut(action, guestFocusEditable) {
  if (action === GUEST_FOCUS_ADDRESS_ACTION || action === GUEST_RELOAD_ACTION) return true;
  if (!GUEST_TAB_SHORTCUT_ACTIONS.has(action)) return false;
  if (!guestFocusEditable) return true;
  return BROWSER_LEVEL_WHEN_EDITABLE.has(action);
}

function resolveGuestShortcutAction(event) {
  if (!event) return null;
  if (event.key === "F5") return GUEST_RELOAD_ACTION;
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.key;
  if ((key === "l" || key === "L") && !event.shiftKey) return GUEST_FOCUS_ADDRESS_ACTION;
  if ((key === "r" || key === "R") && !event.shiftKey) return GUEST_RELOAD_ACTION;
  if (key === "T" || key === "t") return event.shiftKey ? "reopen-tab" : "new-tab";
  if ((key === "W" || key === "w") && !event.shiftKey) return "close-tab";
  if (key === "Tab" && event.shiftKey) return "prev-tab";
  if (key === "Tab" && !event.shiftKey) return "next-tab";
  return null;
}

function createGuestTabShortcutKeydownHandler(sendToHost, isGuestFocusEditable) {
  return function onGuestTabShortcutKeydown(event) {
    const action = resolveGuestShortcutAction(event);
    if (!action) return;
    const editable = typeof isGuestFocusEditable === "function" ? isGuestFocusEditable() : !!isGuestFocusEditable;
    if (!shouldForwardGuestTabShortcut(action, editable)) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    sendToHost(GUEST_TAB_SHORTCUT_CHANNEL, action);
  };
}

module.exports = {
  GUEST_TAB_SHORTCUT_CHANNEL,
  GUEST_TAB_SHORTCUT_ACTIONS,
  GUEST_FOCUS_ADDRESS_ACTION,
  GUEST_RELOAD_ACTION,
  BROWSER_LEVEL_WHEN_EDITABLE,
  shouldForwardGuestTabShortcut,
  resolveGuestShortcutAction,
  createGuestTabShortcutKeydownHandler
};
