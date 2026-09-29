/* Distinguish MBrowser shell (file:// chrome) from tab <webview> guests. */
function isTabWebviewGuestPreload(locationHref, hasSendToHost) {
  if (!hasSendToHost) return false;
  if (typeof locationHref === "string" && locationHref.startsWith("file:")) return false;
  return true;
}

module.exports = { isTabWebviewGuestPreload };
