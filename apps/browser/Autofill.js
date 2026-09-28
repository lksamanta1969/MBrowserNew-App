/**
 * MBrowser Autofill Engine (Phase 1E-C.1 / 1E-C.2)
 * C.1: form detection + WebView integration.
 * C.2 step 1: privacy gating + safe origin-scoped credential lookup (no fill/UI yet).
 * C.2 step 2: autofill offer UI (no credential filling yet).
 * C.2 step 3: user-confirmed credential fill (no auto-fill, no auto-submit).
 * C.2 step 4: post-fill lifecycle suppression (no duplicate offers/reports until navigation).
 * C.2 step 5: dismiss offer on Escape and when the home shell is shown.
 */

const Autofill = createTabService(function (webview, isActive) {
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

  const listeners = new AbortController();
  let epoch = 0;
  function context() {
    let url = "";
    try { url = webview.getURL(); } catch (_) { /* Guest not ready. */ }
    return { epoch, url };
  }
  function current(ctx) {
    return isActive() && ctx.epoch === epoch && ctx.url === context().url;
  }
  function listen(type, handler) {
    webview.addEventListener(type, event => {
      if (isActive()) handler(event);
    }, { signal: listeners.signal });
  }
  let injectTimer = null;
  let lastReportedSignature = "";
  let activePageUrl = "";
  let offerToAutofill = true;
  let neverSaveOrigins = new Set();
  let activeOffer = null;
  /** True after successful explicit Fill until the next navigation/guest cleanup. */
  let lifecycleOfferSuppressed = false;

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (
      !bridge ||
      typeof bridge.passwordsMatch !== "function" ||
      typeof bridge.passwordsRetrieveForFill !== "function"
    ) {
      return null;
    }
    return bridge;
  }

  function isEligibleUrl(url) {
    try {
      const protocol = new URL(String(url || "")).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  function originFromUrl(url) {
    if (!isEligibleUrl(url)) return "";
    try {
      const parsed = new URL(url);
      if (parsed.origin && parsed.origin !== "null") return parsed.origin;
      return "";
    } catch (e) {
      return "";
    }
  }

  function normalizeOriginValue(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "null") return "";
    if (/^(file|about|chrome|edge|data|blob|javascript):/i.test(raw)) return "";
    return originFromUrl(raw) || (isEligibleUrl(raw) ? raw : "");
  }

  function escapeAttr(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function displayHostname(originOrUrl) {
    const value = normalizeOriginValue(originOrUrl) || String(originOrUrl || "").trim();
    if (!value) return "this site";
    try {
      return new URL(value).hostname || "this site";
    } catch (e) {
      return "this site";
    }
  }

  function hideOfferPrompt() {
    activeOffer = null;
    if (!isActive()) return;
    const prompt = document.getElementById("afOfferPrompt");
    if (prompt) prompt.classList.remove("open");
    activeOffer = null;
    const fillBtn = document.getElementById("afOfferFillBtn");
    if (fillBtn) fillBtn.disabled = true;
  }

  function setFillButtonEnabled(enabled) {
    const fillBtn = document.getElementById("afOfferFillBtn");
    if (fillBtn) fillBtn.disabled = !enabled;
  }

  function selectOfferCandidate(candidateId) {
    if (!activeOffer) return;
    activeOffer.selectedId = candidateId;
    const picker = document.getElementById("afOfferPicker");
    if (!picker) return;
    picker.querySelectorAll(".af-offer-user-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.getAttribute("data-id") === candidateId);
    });
    setFillButtonEnabled(!!candidateId);
  }

  function renderOfferPicker(candidates) {
    const picker = document.getElementById("afOfferPicker");
    if (!picker) return;
    picker.hidden = false;
    picker.innerHTML = candidates
      .map(
        (candidate) =>
          `<button type="button" class="af-offer-user-btn" data-id="${escapeAttr(candidate.id)}">${escapeAttr(candidate.username)}</button>`
      )
      .join("");
    picker.querySelectorAll(".af-offer-user-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectOfferCandidate(btn.getAttribute("data-id"));
      });
    });
  }

  function showOfferPrompt(candidates, pageOrigin, pageUrl) {
    if (!isActive()) return;
    if (!candidates || !candidates.length) {
      hideOfferPrompt();
      return;
    }

    const prompt = document.getElementById("afOfferPrompt");
    const titleEl = document.getElementById("afOfferTitle");
    const userEl = document.getElementById("afOfferUser");
    const picker = document.getElementById("afOfferPicker");
    if (!prompt || !titleEl || !userEl || !picker) return;

    hideOfferPrompt();

    const hostLabel = displayHostname(pageOrigin || pageUrl);
    titleEl.innerHTML = "Fill password for <strong>" + escapeAttr(hostLabel) + "</strong>?";

    activeOffer = {
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        username: String(candidate.username || ""),
        origin: candidate.origin
      })),
      selectedId: "",
      origin: normalizeOriginValue(pageOrigin || pageUrl)
    };

    if (candidates.length === 1) {
      picker.hidden = true;
      picker.innerHTML = "";
      userEl.textContent = candidates[0].username || "";
      userEl.hidden = false;
      activeOffer.selectedId = candidates[0].id;
      setFillButtonEnabled(true);
    } else {
      userEl.textContent = "Choose an account:";
      userEl.hidden = false;
      renderOfferPicker(activeOffer.candidates);
      setFillButtonEnabled(false);
    }

    prompt.classList.add("open");
  }

  function dismissOffer() {
    hideOfferPrompt();
  }

  function onShellHomeShown() {
    hideOfferPrompt();
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (isActive() && e.key === "Escape") dismissOffer();
    }, { signal: listeners.signal });
  }

  async function lookupCredentialForFill(id, pageOrigin) {
    const bridge = ensureApi();
    if (!bridge || !id || !pageOrigin) return null;

    const result = await bridge.passwordsRetrieveForFill({
      id,
      origin: pageOrigin
    });
    if (!result || !result.success || !result.data) return null;

    return {
      username: String(result.data.username || ""),
      password: String(result.data.password || "")
    };
  }

  async function invokeGuestFill(credential, ctx) {
    if (!current(ctx)) return { ok: false };
    if (!webview || !credential) {
      return { ok: false, filledUsername: false, filledPassword: false };
    }

    const payload = JSON.stringify({
      username: credential.username,
      password: credential.password
    });

    try {
      return await webview.executeJavaScript(
        `(function(){
          if (location.href !== ${JSON.stringify(ctx.url)}) return { ok: false };
          if (!window.__MB_AF || typeof window.__MB_AF.applyFill !== "function") {
            return { ok: false, filledUsername: false, filledPassword: false };
          }
          return window.__MB_AF.applyFill(${payload});
        })()`,
        true
      );
    } catch (e) {
      return { ok: false, filledUsername: false, filledPassword: false };
    }
  }

  async function fillSelected() {
    const ctx = context();
    if (!current(ctx)) return;
    if (!activeOffer || !activeOffer.selectedId || !webview) return;

    const selectedId = activeOffer.selectedId;
    const offerOrigin = activeOffer.origin;
    console.log("[Autofill] Fill requested");

    let currentUrl = "";
    try {
      currentUrl = webview.getURL ? webview.getURL() : "";
    } catch (e) {
      console.log("[Autofill] Fill failed");
      return;
    }

    const pageOrigin = normalizeOriginValue(currentUrl);
    if (!pageOrigin || !offerOrigin || pageOrigin !== offerOrigin) {
      console.log("[Autofill] Fill failed");
      return;
    }

    if (!(await canOfferAutofill(currentUrl))) {
      console.log("[Autofill] Fill failed");
      return;
    }

    if (!current(ctx)) return;
    let credential = await lookupCredentialForFill(selectedId, pageOrigin);
    if (!current(ctx)) { credential = null; return; }
    if (!credential || !credential.password) {
      console.log("[Autofill] Fill failed");
      return;
    }

    const fillResult = await invokeGuestFill(credential, ctx);
    credential = null;

    if (!current(ctx)) return;
    if (fillResult && fillResult.ok) {
      console.log("[Autofill] Filled");
      lifecycleOfferSuppressed = true;
      hideOfferPrompt();
      return;
    }

    console.log("[Autofill] Fill failed");
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

  async function refreshSettingsFlags() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.settingsGet !== "function") {
      offerToAutofill = true;
      return;
    }
    const result = await bridge.settingsGet();
    const privacy = (result && result.data && result.data.privacy) || {};
    offerToAutofill = privacy.offerToAutofillPasswords !== false;
  }

  async function refreshNeverSave() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.neverSaveGet !== "function") {
      neverSaveOrigins = new Set();
      return;
    }
    const result = await bridge.neverSaveGet();
    const origins = (result && result.data && result.data.origins) || [];
    neverSaveOrigins = new Set(origins.map((item) => normalizeOriginValue(item)));
  }

  function shouldRunDetection(url) {
    if (!isActive()) return false;
    if (!webview) return false;
    if (isHomeVisible()) return false;
    if (typeof onHomePage !== "undefined" && onHomePage) return false;
    if (!isEligibleUrl(url)) return false;
    if (isInternalAppUrl(url)) return false;
    return true;
  }

  async function canOfferAutofill(urlOrOrigin) {
    await refreshSettingsFlags();
    if (!offerToAutofill) return false;
    if (!isEligibleUrl(urlOrOrigin) && !normalizeOriginValue(urlOrOrigin)) return false;
    if (isInternalAppUrl(urlOrOrigin)) return false;
    const origin = normalizeOriginValue(urlOrOrigin);
    if (!origin) return false;
    await refreshNeverSave();
    if (neverSaveOrigins.has(origin)) return false;
    return true;
  }

  function toOfferCandidate(entry, fallbackOrigin) {
    return {
      id: entry.id,
      username: String(entry.username || ""),
      origin: normalizeOriginValue(entry.origin || entry.url) || fallbackOrigin
    };
  }

  async function lookupOfferCandidates(urlOrOrigin) {
    const origin = normalizeOriginValue(urlOrOrigin);
    if (!origin) return [];

    const bridge = ensureApi();
    if (!bridge) return [];

    const result = await bridge.passwordsMatch({ origin });
    if (!result || !result.success) return [];

    const matches = (result.data && result.data.matches) || [];
    return matches
      .filter((match) => match && match.id)
      .map((match) => toOfferCandidate(match, origin));
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

  async function evaluateDetectionOffer(result) {
    if (!result || !result.hasLoginForm) {
      return { allowed: false, candidates: [] };
    }

    const pageOrigin = normalizeOriginValue(result.origin || result.url);
    const allowed = await canOfferAutofill(pageOrigin || result.url || result.origin);
    if (!allowed) {
      return { allowed: false, candidates: [] };
    }

    const candidates = await lookupOfferCandidates(pageOrigin);
    return { allowed: true, candidates };
  }

  async function handleDetectionResult(result) {
    const ctx = context();
    if (!current(ctx) || (result && result.url && result.url !== ctx.url)) return;
    if (!result || !result.hasLoginForm) {
      if (!result || !result.hasPasswordField) {
        lastReportedSignature = "";
      }
      return;
    }

    if (lifecycleOfferSuppressed) {
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

    const offer = await evaluateDetectionOffer(result);
    if (!current(ctx)) return;
    if (!offer.allowed || !offer.candidates.length) {
      hideOfferPrompt();
      return;
    }

    console.log("[Autofill] Offer candidates:", offer.candidates.length);
    showOfferPrompt(
      offer.candidates,
      normalizeOriginValue(result.origin || result.url),
      result.url || result.origin
    );
  }

  async function pollGuestStatus() {
    const ctx = context();
    if (!current(ctx)) return;
    if (!webview) return;
    try {
      const result = await webview.executeJavaScript(
        `(function(){
          if (!window.__MB_AF || typeof window.__MB_AF.getStatus !== "function") return null;
          return window.__MB_AF.getStatus();
        })()`,
        true
      );
      if (current(ctx) && result) await handleDetectionResult(result);
    } catch (e) {
      /* cross-origin or destroyed guest */
    }
  }

  async function injectDetector() {
    const ctx = context();
    if (!current(ctx)) return;
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
      hideOfferPrompt();
      return;
    }

    const source = buildInjectSource();
    if (!source) return;

    try {
      const initial = await webview.executeJavaScript(source, true);
      if (!current(ctx)) return;
      if (initial) await handleDetectionResult(initial);
      if (!current(ctx)) return;

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
    if (!isActive()) return;
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectDetector();
    }, INJECT_DEBOUNCE_MS);
  }

  async function onNavigation(url) {
    epoch++;
    const ctx = context();
    lastReportedSignature = "";
    lifecycleOfferSuppressed = false;
    hideOfferPrompt();
    await cleanupGuest();
    if (current(ctx)) scheduleInject();
  }

  function bindWebview() {
    listen("did-start-navigation", event => {
      if (event.isMainFrame === false) return;
      epoch++;
      hideOfferPrompt();
    });
    if (!webview) return;

    listen("ipc-message", (event) => {
      if (!event || event.channel !== "af:form-detected") return;
      const payload = event.args && event.args[0];
      if (!payload || !payload.hasLoginForm) return;
      handleDetectionResult(payload);
    });

    listen("dom-ready", () => {
      scheduleInject();
    });

    listen("did-finish-load", () => {
      try {
        onNavigation(webview.getURL ? webview.getURL() : "");
      } catch (e) {
        scheduleInject();
      }
    });

    listen("did-navigate", (e) => {
      if (e && e.url) onNavigation(e.url);
      else scheduleInject();
    });

    listen("did-navigate-in-page", (e) => {
      if (e && e.url) onNavigation(e.url);
      else scheduleInject();
    });
  }

  async function init() {
    await refreshSettingsFlags();
    await refreshNeverSave();
    bindWebview();
    bindKeyboard();
  }


  function suspend() {
    epoch++;
    if (injectTimer) clearTimeout(injectTimer);
    hideOfferPrompt();
    lastReportedSignature = "";
  }
  function resume() {
    if (!isActive()) return;
    if (context().url !== activePageUrl) onNavigation(context().url);
    else scheduleInject();
  }
  function dispose() { suspend(); listeners.abort(); }

  return {
    suspend, resume, dispose,
    init,
    refreshSettingsFlags,
    refreshNeverSave,
    normalizeOriginValue,
    canOfferAutofill,
    lookupOfferCandidates,
    showOfferPrompt,
    dismissOffer,
    onShellHomeShown,
    fillSelected,
    isInternalAppUrl,
    INTERNAL_APP_PREFIXES
  };
});

window.Autofill = Autofill;
