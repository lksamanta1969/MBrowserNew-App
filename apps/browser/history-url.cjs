/** History URL identity: strip openApp cache-bust (?v=) for embedded MBrowser apps only. */

function isEmbeddedAppHistoryUrl(parsed) {
  return (
    parsed.protocol === "http:" &&
    parsed.hostname === "localhost" &&
    parsed.port === "3000" &&
    /^\/apps\/[^/]+\/index\.html$/i.test(parsed.pathname)
  );
}

function normalizeHistoryUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return raw;

  try {
    const parsed = new URL(raw);
    if (isEmbeddedAppHistoryUrl(parsed)) {
      parsed.searchParams.delete("v");
      const qs = parsed.searchParams.toString();
      parsed.search = qs ? "?" + qs : "";
      return parsed.href;
    }
  } catch (e) {
    /* ignore invalid URLs */
  }

  return raw;
}

function isRecordableHistoryUrl(url) {
  if (!url) return false;
  if (url === "about:blank") return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-error://")) return false;
  if (url.startsWith("data:")) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

module.exports = {
  normalizeHistoryUrl,
  isRecordableHistoryUrl
};
