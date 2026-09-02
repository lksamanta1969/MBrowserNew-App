/**
 * MBrowser Login Detection Engine (Phase 1E-B)
 * Detects successful website logins and offers to save credentials.
 * Does NOT autofill or inject passwords.
 */

const LoginDetection = (function () {
  const CAPTURE_TTL_MS = 45000;
  const LOGIN_PATH_RE = /\/(login|log-in|signin|sign-in|sign_in|auth|authenticate|session|account\/login|user\/login)(\/|$|\?|#)/i;

  let webview = null;
  let enabled = true;
  let offerToSave = true;
  let neverSaveOrigins = new Set();
  let activePrompt = null;
  let lastHandledKey = "";
  let injectTimer = null;
  let hostPending = null;

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.passwordsGet !== "function") {
      console.warn("[LoginDetection] electronAPI not available");
      return null;
    }
    return bridge;
  }

  function escapeAttr(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function displayHostname(candidate) {
    const candidates = [candidate && candidate.url, candidate && candidate.origin];
    for (let i = 0; i < candidates.length; i++) {
      const value = candidates[i];
      if (!isEligibleUrl(value)) continue;
      try {
        return new URL(value).hostname || "this site";
      } catch (e) {
        /* try next */
      }
    }
    return "this site";
  }

  function looksLikeLoginUrl(url) {
    try {
      const u = new URL(url);
      return LOGIN_PATH_RE.test(u.pathname + u.search);
    } catch (e) {
      return LOGIN_PATH_RE.test(String(url || ""));
    }
  }

  async function refreshSettingsFlags() {
    const bridge = ensureApi();
    if (!bridge || typeof bridge.settingsGet !== "function") {
      enabled = true;
      offerToSave = true;
      return;
    }
    const result = await bridge.settingsGet();
    const privacy = (result && result.data && result.data.privacy) || {};
    enabled = privacy.enableLoginDetection !== false;
    offerToSave = privacy.offerToSavePasswords !== false;
  }

  async function refreshNeverSave() {
    const bridge = ensureApi();
    if (!bridge || typeof bridge.neverSaveGet !== "function") {
      neverSaveOrigins = new Set();
      return;
    }
    const result = await bridge.neverSaveGet();
    const origins = (result && result.data && result.data.origins) || [];
    neverSaveOrigins = new Set(origins.map((item) => normalizeOriginValue(item)));
  }

  function captureScriptSource() {
    return `(() => {
      if (window.__MB_LD && window.__MB_LD.__ready) return true;
      const state = {
        __ready: true,
        pending: null,
        lastSubmitAt: 0,
        setPending(payload) {
          if (!payload || !payload.password || !payload.username) return;
          const protocol = String(location.protocol || "").toLowerCase();
          if (protocol !== "http:" && protocol !== "https:") return;
          this.pending = payload;
          this.lastSubmitAt = Date.now();
          try {
            if (
              window.electronAPI &&
              typeof window.electronAPI.reportLoginPending === "function"
            ) {
              window.electronAPI.reportLoginPending(payload);
            }
          } catch (e) {
            /* ignore */
          }
        },
        peek() { return this.pending; },
        consume() {
          const value = this.pending;
          this.pending = null;
          return value;
        },
        clear() { this.pending = null; },
        hasPasswordForm() {
          return !!document.querySelector('input[type="password"]');
        }
      };
      window.__MB_LD = state;

      function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function findPasswordInputs(root) {
        return Array.from((root || document).querySelectorAll('input[type="password"]')).filter(isVisible);
      }

      function scoreUsername(input) {
        const name = ((input.name || "") + " " + (input.id || "") + " " + (input.autocomplete || "") + " " + (input.placeholder || "")).toLowerCase();
        if (input.type === "password") return -100;
        if (input.type === "hidden") return -100;
        if (/pass|pwd|token|csrf|captcha|search|otp|code/.test(name)) return -50;
        let score = 0;
        if (input.type === "email") score += 8;
        if (/user|email|login|account|identifier|phone/.test(name)) score += 6;
        if ((input.autocomplete || "").toLowerCase() === "username") score += 10;
        if ((input.autocomplete || "").toLowerCase() === "email") score += 8;
        if (isVisible(input)) score += 2;
        return score;
      }

      function findUsername(form, passwordInput) {
        const scope = form || passwordInput.form || passwordInput.closest("form") || document;
        const candidates = Array.from(scope.querySelectorAll("input")).filter((input) => {
          if (input === passwordInput) return false;
          const type = (input.type || "text").toLowerCase();
          return ["text", "email", "tel", "url", "search", ""].includes(type);
        });
        candidates.sort((a, b) => scoreUsername(b) - scoreUsername(a));
        const best = candidates[0];
        if (!best || scoreUsername(best) < 1) return null;
        return best;
      }

      function captureNear(passwordInput) {
        if (!passwordInput || !passwordInput.value) return;
        const form = passwordInput.form || passwordInput.closest("form");
        const userInput = findUsername(form, passwordInput);
        if (!userInput || !String(userInput.value || "").trim()) return;
        state.setPending({
          url: location.href,
          origin: (location.origin && location.origin !== "null") ? location.origin : "",
          username: String(userInput.value || "").trim(),
          password: String(passwordInput.value || ""),
          submittedAt: Date.now()
        });
      }

      function captureFromForm(form) {
        if (!form || !form.querySelector) return;
        const passwords = findPasswordInputs(form);
        if (!passwords.length) return;
        captureNear(passwords[passwords.length - 1]);
      }

      document.addEventListener("submit", (event) => {
        const form = event.target;
        if (form && form.tagName === "FORM") captureFromForm(form);
      }, true);

      document.addEventListener("click", (event) => {
        const target = event.target && event.target.closest
          ? event.target.closest('button, input[type="submit"], input[type="image"], [role="button"]')
          : null;
        if (!target) return;
        const form = target.form || target.closest("form");
        if (form) {
          captureFromForm(form);
          return;
        }
        const passwords = findPasswordInputs(document);
        if (passwords.length === 1) captureNear(passwords[0]);
      }, true);

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const active = document.activeElement;
        if (!active || active.tagName !== "INPUT") return;
        const form = active.form || active.closest("form");
        if (form) captureFromForm(form);
        else if ((active.type || "").toLowerCase() === "password") captureNear(active);
      }, true);

      return true;
    })()`;
  }

  async function injectCapture() {
    if (!webview) return;
    try {
      const home = document.getElementById("home");
      if (home && home.style.display !== "none" && webview.style.display === "none") return;
    } catch (e) {
      /* ignore */
    }
    if (!enabled) return;
    try {
      const currentUrl = webview.getURL ? webview.getURL() : "";
      if (!isEligibleUrl(currentUrl)) return;
    } catch (e) {
      return;
    }
    try {
      await webview.executeJavaScript(captureScriptSource(), true);
    } catch (e) {
      /* cross-origin or not ready */
    }
  }

  function scheduleInject() {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectCapture();
    }, 250);
  }

  async function peekGuestPending() {
    if (!webview) return { value: null, error: "no-webview" };
    try {
      const value = await webview.executeJavaScript(
        `(function(){ return (window.__MB_LD && window.__MB_LD.peek) ? window.__MB_LD.peek() : null; })()`,
        true
      );
      return { value: value || null, error: null };
    } catch (e) {
      return { value: null, error: String(e) };
    }
  }

  async function peekPending() {
    if (hostPending) {
      return hostPending;
    }
    const guest = await peekGuestPending();
    return guest.value;
  }

  async function clearPending() {
    hostPending = null;
    if (!webview) return;
    try {
      await webview.executeJavaScript(
        `(function(){ if (window.__MB_LD && window.__MB_LD.clear) window.__MB_LD.clear(); return true; })()`,
        true
      );
    } catch (e) {
      /* ignore */
    }
  }

  async function pageHasPasswordForm() {
    if (!webview) return false;
    try {
      return !!(await webview.executeJavaScript(
        `(function(){ return !!(window.__MB_LD && window.__MB_LD.hasPasswordForm && window.__MB_LD.hasPasswordForm()); })()`,
        true
      ));
    } catch (e) {
      return false;
    }
  }

  function candidateKey(candidate) {
    return [
      candidate.origin || "",
      candidate.username || "",
      candidate.password || "",
      candidate.submittedAt || 0
    ].join("|");
  }

  function isSuccessfulLogin(candidate, currentUrl, stillHasPasswordForm) {
    if (!candidate || !candidate.password || !candidate.username) return false;
    if (!isEligibleUrl(candidate.url || candidate.origin)) return false;
    if (!isEligibleUrl(currentUrl)) return false;
    const age = Date.now() - (candidate.submittedAt || 0);
    if (age < 0 || age > CAPTURE_TTL_MS) return false;

    const submitOrigin = candidate.origin || originFromUrl(candidate.url);
    const currentOrigin = originFromUrl(currentUrl) || submitOrigin;

    // Cross-origin navigations after login (SSO / redirects)
    if (submitOrigin && currentOrigin && submitOrigin !== currentOrigin && age < CAPTURE_TTL_MS) {
      return true;
    }

    if (currentUrl && candidate.url) {
      const cur = String(currentUrl).split("#")[0];
      const src = String(candidate.url).split("#")[0];
      if (cur !== src) {
        if (!looksLikeLoginUrl(currentUrl) || !stillHasPasswordForm) return true;
      }
    }

    if (!stillHasPasswordForm) return true;
    return false;
  }

  function hidePrompts() {
    const savePrompt = document.getElementById("ldSavePrompt");
    const updatePrompt = document.getElementById("ldUpdatePrompt");
    if (savePrompt) savePrompt.classList.remove("open");
    if (updatePrompt) updatePrompt.classList.remove("open");
    activePrompt = null;
  }

  function showSavePrompt(candidate, existing) {
    hidePrompts();
    activePrompt = { candidate, existing: existing || null };
    const hostLabel = displayHostname(candidate);

    if (existing) {
      const prompt = document.getElementById("ldUpdatePrompt");
      const text = document.getElementById("ldUpdateText");
      if (!prompt || !text) return;
      text.textContent =
        "Update password for " +
        (candidate.username || "this account") +
        " on " +
        hostLabel +
        "?";
      prompt.classList.add("open");
      return;
    }

    const prompt = document.getElementById("ldSavePrompt");
    const text = document.getElementById("ldSaveText");
    if (!prompt || !text) return;
    text.innerHTML =
      "Save password for <strong>" +
      escapeAttr(hostLabel) +
      "</strong>?";
    const userEl = document.getElementById("ldSaveUser");
    if (userEl) userEl.textContent = candidate.username || "";
    prompt.classList.add("open");
  }

  async function findExisting(candidate) {
    const bridge = ensureApi();
    if (!bridge) return null;
    const result = await bridge.passwordsGet();
    const entries = (result && result.data && result.data.entries) || [];
    const origin = normalizeOriginValue(candidate.origin || candidate.url);
    return (
      entries.find((entry) => {
        if (String(entry.username || "") !== String(candidate.username || "")) return false;
        const entryOrigin = normalizeOriginValue(entry.origin || entry.url);
        return entryOrigin && origin && entryOrigin === origin;
      }) || null
    );
  }

  async function handlePossibleSuccess(currentUrl) {
    await refreshSettingsFlags();
    if (!enabled || !offerToSave) {
      return;
    }
    if (!currentUrl || !isEligibleUrl(currentUrl)) {
      if (hostPending && !isEligibleUrl(hostPending.url || hostPending.origin)) {
        await clearPending();
      }
      return;
    }

    const candidate = await peekPending();
    if (!candidate) {
      return;
    }
    if (!isEligibleUrl(candidate.url || candidate.origin)) {
      await clearPending();
      return;
    }

    const key = candidateKey(candidate);
    if (key === lastHandledKey) return;

    const origin = normalizeOriginValue(candidate.origin || candidate.url);
    if (!origin || neverSaveOrigins.has(origin)) {
      await clearPending();
      return;
    }

    // Re-inject so hasPasswordForm works after navigation
    await injectCapture();
    const stillHasForm = await pageHasPasswordForm();
    if (!isSuccessfulLogin(candidate, currentUrl, stillHasForm)) return;

    lastHandledKey = key;
    await clearPending();

    const existing = await findExisting(candidate);
    if (existing && existing.password === candidate.password) return;

    showSavePrompt(
      {
        ...candidate,
        origin,
        url: currentUrl || candidate.url
      },
      existing
    );
  }

  async function saveCandidate() {
    const bridge = ensureApi();
    if (!bridge || !activePrompt || !activePrompt.candidate) return;
    const candidate = activePrompt.candidate;
    const existing = activePrompt.existing;
    hidePrompts();

    let result;
    if (existing && existing.id) {
      result = await bridge.passwordsUpdate({
        id: existing.id,
        url: candidate.url,
        origin: candidate.origin,
        username: candidate.username,
        password: candidate.password
      });
    } else {
      result = await bridge.passwordsAdd({
        url: candidate.url,
        origin: candidate.origin,
        username: candidate.username,
        password: candidate.password
      });
    }

    if (!result || !result.success) {
      alert((result && result.error) || "Could not save password.");
      return;
    }

    if (window.Passwords) {
      if (typeof Passwords.applyExternalData === "function") {
        Passwords.applyExternalData(result.data);
      } else if (typeof Passwords.refresh === "function") {
        await Passwords.refresh();
      }
    }
  }

  async function neverSaveCandidate() {
    const bridge = ensureApi();
    if (!bridge || !activePrompt || !activePrompt.candidate) {
      hidePrompts();
      return;
    }
    const origin = normalizeOriginValue(activePrompt.candidate.origin);
    hidePrompts();
    await clearPending();
    if (!origin) return;
    const result = await bridge.neverSaveAdd(origin);
    if (result && result.success) {
      neverSaveOrigins.add(normalizeOriginValue(result.origin || origin));
    }
  }

  function dismissPrompt() {
    hidePrompts();
  }

  function onNavigated(url) {
    scheduleInject();
    setTimeout(() => {
      handlePossibleSuccess(url || "");
    }, 500);
  }

  function bindWebview() {
    webview = document.getElementById("browser");
    if (!webview) return;

    webview.addEventListener("ipc-message", (event) => {
      if (!event || event.channel !== "ld:pending") return;
      const payload = event.args && event.args[0];
      if (!payload || !payload.password || !payload.username) {
        return;
      }
      if (!isEligibleUrl(payload.url || payload.origin)) {
        return;
      }
      hostPending = {
        ...payload,
        submittedAt: payload.submittedAt || Date.now()
      };
      setTimeout(() => {
        try {
          const url = webview.getURL ? webview.getURL() : "";
          handlePossibleSuccess(url || "");
        } catch (e) {
          /* ignore */
        }
      }, 700);
    });

    webview.addEventListener("dom-ready", () => {
      scheduleInject();
    });

    webview.addEventListener("did-finish-load", () => {
      scheduleInject();
      try {
        onNavigated(webview.getURL());
      } catch (e) {
        /* ignore */
      }
    });

    webview.addEventListener("did-navigate", (e) => {
      if (e && e.url) onNavigated(e.url);
    });

    webview.addEventListener("did-navigate-in-page", (e) => {
      if (e && e.url) onNavigated(e.url);
    });
  }

  async function init() {
    await refreshSettingsFlags();
    await refreshNeverSave();
    bindWebview();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismissPrompt();
    });
  }

  return {
    init,
    saveCandidate,
    neverSaveCandidate,
    dismissPrompt,
    updateCandidate: saveCandidate,
    cancelUpdate: dismissPrompt,
    refreshSettingsFlags,
    refreshNeverSave
  };
})();

window.LoginDetection = LoginDetection;
