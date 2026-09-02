/**
 * MBrowser Autofill Engine (Phase 1E-C.1)
 * Form detection + WebView integration only. No vault access, fill, or popup.
 */

const Autofill = (function () {
  const INJECT_DEBOUNCE_MS = 250;

  /** Centralized internal-app exclusion (localhost MBrowser apps). */
  const INTERNAL_APP_PREFIXES = [
    "http://localhost:3000/apps/mmail/",
    "http://localhost:3000/apps/mdrive/",
    "http://localhost:3000/apps/mpay/",
    "http://localhost:3000/apps/mtube/",
    "http://localhost:3000/apps/mnote/",
    "http://localhost:3000/apps/mcalculator/",
    "http://localhost:3000/apps/mcalender/"
  ];

  let webview = null;
  let injectTimer = null;
  let lastReportedSignature = "";
  let activePageUrl = "";

  function isEligibleUrl(url) {
    try {
      const protocol = new URL(String(url || "")).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  function isInternalAppUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    for (let i = 0; i < INTERNAL_APP_PREFIXES.length; i++) {
      if (lower.startsWith(INTERNAL_APP_PREFIXES[i])) return true;
    }
    return false;
  }

  function isHomeVisible() {
    try {
      const home = document.getElementById("home");
      return !!(home && home.style.display !== "none" && webview && webview.style.display === "none");
    } catch (e) {
      return false;
    }
  }

  function shouldRunDetection(url) {
    if (!webview) return false;
    if (isHomeVisible()) return false;
    if (typeof onHomePage !== "undefined" && onHomePage) return false;
    if (!isEligibleUrl(url)) return false;
    if (isInternalAppUrl(url)) return false;
    return true;
  }

  function buildInjectSource() {
    if (window.AutofillInject && typeof AutofillInject.buildScript === "function") {
      return AutofillInject.buildScript();
    }
    console.warn("[Autofill] AutofillInject.buildScript not available");
    return "";
  }

  async function cleanupGuest() {
    if (!webview) return;
    try {
      await webview.executeJavaScript(
        `(function(){
          if (window.__MB_AF && typeof window.__MB_AF.cleanup === "function") {
            window.__MB_AF.cleanup();
          }
          try { delete window.__MB_AF; } catch (e) { window.__MB_AF = undefined; }
          return true;
        })()`,
        true
      );
    } catch (e) {
      /* guest may be unavailable during navigation */
    }
  }

  function handleDetectionResult(result) {
    if (!result || !result.hasLoginForm) {
      if (!result || !result.hasPasswordField) {
        lastReportedSignature = "";
      }
      return;
    }

    const signature = [
      result.origin || "",
      result.url || "",
      (result.fields || [])
        .map((field) =>
          [field.role, field.type, field.name, field.id, field.autocomplete].join("|")
        )
        .join(";")
    ].join("::");

    if (signature === lastReportedSignature) return;
    lastReportedSignature = signature;
    console.log("[Autofill] Form detected");
  }

  async function pollGuestStatus() {
    if (!webview) return;
    try {
      const result = await webview.executeJavaScript(
        `(function(){
          if (!window.__MB_AF || typeof window.__MB_AF.getStatus !== "function") return null;
          return window.__MB_AF.getStatus();
        })()`,
        true
      );
      if (result) handleDetectionResult(result);
    } catch (e) {
      /* cross-origin or destroyed guest */
    }
  }

  async function injectDetector() {
    if (!webview) return;

    let currentUrl = "";
    try {
      currentUrl = webview.getURL ? webview.getURL() : "";
    } catch (e) {
      return;
    }

    activePageUrl = currentUrl;

    if (!shouldRunDetection(currentUrl)) {
      await cleanupGuest();
      lastReportedSignature = "";
      return;
    }

    const source = buildInjectSource();
    if (!source) return;

    try {
      const initial = await webview.executeJavaScript(source, true);
      if (initial) handleDetectionResult(initial);

      let guestUrl = "";
      try {
        guestUrl = webview.getURL ? webview.getURL() : "";
      } catch (e) {
        return;
      }
      if (guestUrl !== activePageUrl) return;

      await pollGuestStatus();
    } catch (e) {
      /* guest not ready or cross-origin restriction */
    }
  }

  function scheduleInject() {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectDetector();
    }, INJECT_DEBOUNCE_MS);
  }

  async function onNavigation(url) {
    lastReportedSignature = "";
    await cleanupGuest();
    scheduleInject();
  }

  function bindWebview() {
    webview = document.getElementById("browser");
    if (!webview) return;

    webview.addEventListener("ipc-message", (event) => {
      if (!event || event.channel !== "af:form-detected") return;
      const payload = event.args && event.args[0];
      if (!payload || !payload.hasLoginForm) return;
      handleDetectionResult(payload);
    });

    webview.addEventListener("dom-ready", () => {
      scheduleInject();
    });

    webview.addEventListener("did-finish-load", () => {
      try {
        onNavigation(webview.getURL ? webview.getURL() : "");
      } catch (e) {
        scheduleInject();
      }
    });

    webview.addEventListener("did-navigate", (e) => {
      if (e && e.url) onNavigation(e.url);
      else scheduleInject();
    });

    webview.addEventListener("did-navigate-in-page", (e) => {
      if (e && e.url) onNavigation(e.url);
      else scheduleInject();
    });
  }

  function init() {
    bindWebview();
  }

  return {
    init,
    isInternalAppUrl,
    INTERNAL_APP_PREFIXES
  };
})();

window.Autofill = Autofill;
