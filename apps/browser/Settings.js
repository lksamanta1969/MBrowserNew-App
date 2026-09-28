/**
 * MBrowser Settings Engine
 * Single source of truth for browser configuration.
 */

const Settings = (function () {
  const SEARCH_PROVIDERS = {
    google: "https://www.google.com/search?q=%s",
    bing: "https://www.bing.com/search?q=%s",
    duckduckgo: "https://duckduckgo.com/?q=%s",
    yahoo: "https://search.yahoo.com/search?p=%s"
  };

  const SECTIONS = [
    { id: "general", label: "General", icon: "⚙" },
    { id: "appearance", label: "Appearance", icon: "🎨" },
    { id: "startup", label: "Startup", icon: "🚀" },
    { id: "search", label: "Search Engine", icon: "🔍" },
    { id: "downloads", label: "Downloads", icon: "⬇" },
    { id: "privacy", label: "Privacy & Security", icon: "🔒" },
    { id: "bookmarks", label: "Bookmarks", icon: "📑" },
    { id: "history", label: "History", icon: "🕐" },
    { id: "mdrive", label: "MDrive", icon: "📁" },
    { id: "advanced", label: "Advanced", icon: "🛠" },
    { id: "about", label: "About MBrowser", icon: "ℹ" }
  ];

  let store = null;
  let activeSection = "general";
  let searchQuery = "";
  let aboutInfo = null;
  let mediaQuery = null;

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.settingsGet !== "function") {
      console.warn("[Settings] electronAPI not available");
      return null;
    }
    return bridge;
  }

  function get(path, fallback) {
    if (!store) return fallback;
    const parts = String(path).split(".");
    let cur = store;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object" || !(part in cur)) return fallback;
      cur = cur[part];
    }
    return cur === undefined ? fallback : cur;
  }

  async function refreshStore() {
    const bridge = ensureApi();
    if (!bridge) return store;
    const result = await bridge.settingsGet();
    if (result && result.success && result.data) {
      store = result.data;
    }
    return store;
  }

  async function savePatch(patch) {
    const bridge = ensureApi();
    if (!bridge) return null;
    const result = await bridge.settingsSet(patch);
    if (result && result.success && result.data) {
      store = result.data;
      applyRuntimeEffects(patch);
      if (isOpen()) renderActiveSection();
      return store;
    }
    alert((result && result.error) || "Could not save settings.");
    return null;
  }

  function isOpen() {
    const el = document.getElementById("settingsManager");
    return !!(el && el.classList.contains("open"));
  }

  function resolveTheme(theme) {
    const mode = theme || get("appearance.theme", "system");
    if (mode === "system") {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return mode === "dark" ? "dark" : "light";
  }

  function applyTheme() {
    const resolved = resolveTheme();
    document.body.setAttribute("data-theme", resolved);
    document.body.classList.toggle("compact-mode", !!get("appearance.compactMode", false));
    document.body.classList.toggle("show-status-bar", !!get("appearance.showStatusBar", false));

    const accent = get("appearance.accentColor", "#b45309");
    document.documentElement.style.setProperty("--mb-accent", accent);
  }

  function applyBookmarksBarVisibility() {
    const show = !!get("appearance.showBookmarksBar", true);
    const bar = document.getElementById("bookmarksBar");
    if (bar) {
      bar.style.display = show ? "flex" : "none";
    }
    document.body.classList.toggle("has-bookmarks-bar", show);
    if (show && window.Bookmarks && typeof Bookmarks.refreshBar === "function") {
      Bookmarks.refreshBar();
    }
  }

  async function reloadAndApply() {
    await refreshStore();
    applyRuntimeEffects({});
  }

  function applyZoom() {
    const zoom = Number(get("general.defaultZoom", 100)) || 100;
    try {
      const browser = document.getElementById("browser");
      if (browser && browser.setZoomFactor) {
        browser.setZoomFactor(zoom / 100);
      }
    } catch (e) {
      /* webview may not be ready */
    }
  }

  function applyPlaceholders() {
    const provider = get("searchEngine.provider", "google");
    const urlLabel =
      provider === "custom"
        ? "Search or Enter URL"
        : "Search MBrowser or Enter URL";
    const homeLabel =
      provider === "custom"
        ? "Search or Enter URL"
        : "Search MBrowser or type a URL";
    const url = document.getElementById("url");
    const home = document.getElementById("homesearch");
    if (url) url.placeholder = urlLabel;
    if (home) home.placeholder = homeLabel;
  }

  function applyBrowserTitle() {
    const name = get("general.browserName", "MBrowser") || "MBrowser";
    document.title = name;
    const homeTitle = document.querySelector(".home h1");
    if (homeTitle) homeTitle.textContent = name;
  }

  function applyRuntimeEffects(patch) {
    applyTheme();
    applyBookmarksBarVisibility();
    applyZoom();
    applyPlaceholders();
    applyBrowserTitle();

    if (patch && patch.bookmarks && patch.bookmarks.showBookmarksBar !== undefined) {
      // already synced via appearance in main, ensure UI
      applyBookmarksBarVisibility();
    }
  }

  function buildSearchUrl(query) {
    const q = encodeURIComponent(String(query || "").trim());
    const provider = get("searchEngine.provider", "google");
    let template = SEARCH_PROVIDERS[provider];
    if (provider === "custom") {
      template = get("searchEngine.customSearchUrl", SEARCH_PROVIDERS.google);
    }
    if (!template) template = SEARCH_PROVIDERS.google;
    return String(template).includes("%s")
      ? String(template).replace("%s", q)
      : String(template) + q;
  }

  function shouldShowBookmarksBar() {
    return !!get("appearance.showBookmarksBar", true);
  }

  function getHomepage() {
    return get("general.homepage", "mbrowser://home") || "mbrowser://home";
  }

  function getNewTabBehavior() {
    return get("general.newTabBehavior", "home") || "home";
  }

  function getStartupMode() {
    return get("startup.mode", "newTab") || "newTab";
  }

  function openHomepage() {
    const homepage = getHomepage();
    if (!homepage || homepage === "mbrowser://home") {
      BrowserTab.showHome();
      return;
    }
    const urlInput = document.getElementById("url");
    if (urlInput) urlInput.value = homepage;
    if (typeof loadSite === "function") loadSite();
  }

  function handleNewTab() {
    const behavior = getNewTabBehavior();
    if (behavior === "homepage") {
      openHomepage();
      return "homepage";
    }
    if (behavior === "blank") {
      BrowserTab.navigate("about:blank");
      return "blank";
    }
    // default home
    return "home";
  }

  function handleStartup() {
    const mode = getStartupMode();
    if (mode === "homepage") {
      setTimeout(() => openHomepage(), 50);
      return;
    }
    if (mode === "restoreSession") {
      // Placeholder: restore not implemented — keep initial new tab/home
      return;
    }
    // newTab: initial home UI is already shown on load
  }

  function sectionMatchesSearch(sectionId) {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const section = SECTIONS.find((s) => s.id === sectionId);
    if (section && section.label.toLowerCase().includes(q)) return true;
    const keywords = {
      general: "browser name homepage zoom new tab",
      appearance: "theme dark light compact bookmark bar status accent",
      startup: "startup session restore homepage",
      search: "search engine google bing duckduckgo yahoo custom",
      downloads: "download folder ask open notifications",
      privacy: "clear history cache cookies do not track safe browsing password save login detection autofill",
      bookmarks: "bookmark bar import export",
      history: "retention max entries cleanup",
      mdrive: "workspace sync folder",
      advanced: "hardware acceleration experimental logging",
      about: "version electron chrome node commit"
    };
    return (keywords[sectionId] || "").includes(q);
  }

  function renderNav() {
    const nav = document.getElementById("settingsNav");
    if (!nav) return;
    nav.innerHTML = "";
    SECTIONS.forEach((section) => {
      if (!sectionMatchesSearch(section.id)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-nav-btn" + (section.id === activeSection ? " active" : "");
      btn.innerHTML = `<span class="settings-nav-icon">${section.icon}</span><span>${section.label}</span>`;
      btn.addEventListener("click", () => {
        activeSection = section.id;
        renderNav();
        renderActiveSection();
      });
      nav.appendChild(btn);
    });
  }

  function fieldRow(label, controlHtml, hint) {
    return (
      `<div class="settings-row">` +
      `<div class="settings-row-text"><div class="settings-row-label">${label}</div>` +
      (hint ? `<div class="settings-row-hint">${hint}</div>` : "") +
      `</div><div class="settings-row-control">${controlHtml}</div></div>`
    );
  }

  function renderActiveSection() {
    const content = document.getElementById("settingsContent");
    const title = document.getElementById("settingsSectionTitle");
    if (!content) return;

    const section = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];
    if (title) title.textContent = section.label;

    const renderers = {
      general: renderGeneral,
      appearance: renderAppearance,
      startup: renderStartup,
      search: renderSearch,
      downloads: renderDownloads,
      privacy: renderPrivacy,
      bookmarks: renderBookmarks,
      history: renderHistorySection,
      mdrive: renderMdrive,
      advanced: renderAdvanced,
      about: renderAbout
    };

    const fn = renderers[activeSection] || renderGeneral;
    content.innerHTML = fn();
    bindSectionHandlers(activeSection);
  }

  function renderGeneral() {
    const zoom = get("general.defaultZoom", 100);
    const behavior = get("general.newTabBehavior", "home");
    return (
      fieldRow(
        "Browser name",
        `<input id="setBrowserName" type="text" value="${escapeAttr(get("general.browserName", "MBrowser"))}">`
      ) +
      fieldRow(
        "Homepage",
        `<input id="setHomepage" type="text" value="${escapeAttr(get("general.homepage", "mbrowser://home"))}">`,
        "Use mbrowser://home for the New Tab page"
      ) +
      fieldRow(
        "New tab behaviour",
        `<select id="setNewTabBehavior">
          <option value="home"${behavior === "home" ? " selected" : ""}>Open home page</option>
          <option value="homepage"${behavior === "homepage" ? " selected" : ""}>Open homepage URL</option>
          <option value="blank"${behavior === "blank" ? " selected" : ""}>Open blank page</option>
        </select>`
      ) +
      fieldRow(
        "Default zoom",
        `<input id="setDefaultZoom" type="number" min="50" max="200" step="10" value="${zoom}"> %`
      )
    );
  }

  function renderAppearance() {
    const theme = get("appearance.theme", "system");
    return (
      fieldRow(
        "Theme",
        `<select id="setTheme">
          <option value="light"${theme === "light" ? " selected" : ""}>Light</option>
          <option value="dark"${theme === "dark" ? " selected" : ""}>Dark</option>
          <option value="system"${theme === "system" ? " selected" : ""}>System</option>
        </select>`
      ) +
      fieldRow(
        "Accent color",
        `<input id="setAccent" type="color" value="${escapeAttr(get("appearance.accentColor", "#b45309"))}">`,
        "Architecture only — stored for future theming"
      ) +
      fieldRow(
        "Compact mode",
        `<label class="settings-switch"><input id="setCompact" type="checkbox"${get("appearance.compactMode") ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Show bookmark bar",
        `<label class="settings-switch"><input id="setShowBmBar" type="checkbox"${get("appearance.showBookmarksBar", true) ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Show status bar",
        `<label class="settings-switch"><input id="setShowStatus" type="checkbox"${get("appearance.showStatusBar") ? " checked" : ""}><span></span></label>`
      )
    );
  }

  function renderStartup() {
    const mode = get("startup.mode", "newTab");
    return (
      fieldRow(
        "On startup",
        `<select id="setStartupMode">
          <option value="newTab"${mode === "newTab" ? " selected" : ""}>Open new tab</option>
          <option value="homepage"${mode === "homepage" ? " selected" : ""}>Open homepage</option>
          <option value="restoreSession"${mode === "restoreSession" ? " selected" : ""}>Restore previous session (placeholder)</option>
        </select>`
      ) +
      fieldRow(
        "Restore previous session",
        `<label class="settings-switch"><input id="setRestoreSession" type="checkbox"${get("startup.restorePreviousSession") ? " checked" : ""} disabled><span></span></label>`,
        "Placeholder for a future session restore engine"
      )
    );
  }

  function renderSearch() {
    const provider = get("searchEngine.provider", "google");
    return (
      fieldRow(
        "Default search engine",
        `<select id="setSearchProvider">
          <option value="google"${provider === "google" ? " selected" : ""}>Google</option>
          <option value="bing"${provider === "bing" ? " selected" : ""}>Bing</option>
          <option value="duckduckgo"${provider === "duckduckgo" ? " selected" : ""}>DuckDuckGo</option>
          <option value="yahoo"${provider === "yahoo" ? " selected" : ""}>Yahoo</option>
          <option value="custom"${provider === "custom" ? " selected" : ""}>Custom</option>
        </select>`
      ) +
      fieldRow(
        "Custom search URL",
        `<input id="setCustomSearch" type="text" value="${escapeAttr(get("searchEngine.customSearchUrl", ""))}">`,
        "Use %s where the query should appear"
      )
    );
  }

  function renderDownloads() {
    const folder = get("downloads.defaultFolder", "") || "(System Downloads folder)";
    return (
      fieldRow(
        "Default download folder",
        `<div class="settings-inline"><input id="setDownloadFolder" type="text" readonly value="${escapeAttr(folder)}"><button type="button" id="setPickDownloadFolder">Browse</button></div>`
      ) +
      fieldRow(
        "Ask before downloading",
        `<label class="settings-switch"><input id="setAskDownload" type="checkbox"${get("downloads.askBeforeDownload", true) ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Auto open downloads",
        `<label class="settings-switch"><input id="setAutoOpenDownloads" type="checkbox"${get("downloads.autoOpenDownloads") ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Show download notifications",
        `<label class="settings-switch"><input id="setDownloadNotify" type="checkbox"${get("downloads.showNotifications", true) ? " checked" : ""}><span></span></label>`
      ) +
      `<div class="settings-actions">
        <button type="button" id="setOpenDownloadsManager">Open Download Manager</button>
      </div>`
    );
  }

  function renderPrivacy() {
    return (
      `<div class="settings-actions">
        <button type="button" id="setClearHistory">Clear browsing history</button>
        <button type="button" id="setClearCache">Clear cache</button>
        <button type="button" id="setClearCookies">Clear cookies</button>
        <button type="button" id="setClearDownloads">Clear download history</button>
      </div>` +
      fieldRow(
        "Do Not Track",
        `<label class="settings-switch"><input id="setDnt" type="checkbox"${get("privacy.doNotTrack") ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Offer to save passwords",
        `<label class="settings-switch"><input id="setOfferSavePasswords" type="checkbox"${get("privacy.offerToSavePasswords", true) ? " checked" : ""}><span></span></label>`,
        "Show a prompt after a successful website login"
      ) +
      fieldRow(
        "Enable login detection",
        `<label class="settings-switch"><input id="setEnableLoginDetection" type="checkbox"${get("privacy.enableLoginDetection", true) ? " checked" : ""}><span></span></label>`,
        "Detect login forms and successful sign-ins"
      ) +
      fieldRow(
        "Offer to autofill passwords",
        `<label class="settings-switch"><input id="setOfferAutofillPasswords" type="checkbox"${get("privacy.offerToAutofillPasswords", true) ? " checked" : ""}><span></span></label>`,
        "Offer saved passwords on matching login forms"
      ) +
      fieldRow(
        "Safe Browsing",
        `<label class="settings-switch"><input id="setSafeBrowsing" type="checkbox"${get("privacy.safeBrowsing") ? " checked" : ""} disabled><span></span></label>`,
        "Placeholder for a future Safe Browsing integration"
      )
    );
  }

  function renderBookmarks() {
    return (
      fieldRow(
        "Show bookmark bar",
        `<label class="settings-switch"><input id="setBmShowBar" type="checkbox"${get("appearance.showBookmarksBar", true) ? " checked" : ""}><span></span></label>`
      ) +
      `<div class="settings-actions">
        <button type="button" id="setBmImport">Import bookmarks</button>
        <button type="button" id="setBmExport">Export bookmarks</button>
        <button type="button" id="setBmOpenManager">Open Bookmark Manager</button>
      </div>`
    );
  }

  function renderHistorySection() {
    return (
      fieldRow(
        "History retention (days)",
        `<input id="setHistRetention" type="number" min="1" max="3650" value="${Number(get("history.retentionDays", 90)) || 90}">`
      ) +
      fieldRow(
        "Maximum entries",
        `<input id="setHistMax" type="number" min="100" max="100000" step="100" value="${Number(get("history.maxEntries", 10000)) || 10000}">`
      ) +
      fieldRow(
        "Auto cleanup",
        `<label class="settings-switch"><input id="setHistAutoCleanup" type="checkbox"${get("history.autoCleanup") ? " checked" : ""} disabled><span></span></label>`,
        "Placeholder for scheduled history cleanup"
      ) +
      `<div class="settings-actions">
        <button type="button" id="setHistOpenManager">Open History Manager</button>
      </div>`
    );
  }

  function renderMdrive() {
    return (
      fieldRow(
        "Default workspace",
        `<input id="setMdriveWorkspace" type="text" value="${escapeAttr(get("mdrive.defaultWorkspace", "mdrive"))}">`
      ) +
      fieldRow(
        "Auto open MDrive",
        `<label class="settings-switch"><input id="setMdriveAutoOpen" type="checkbox"${get("mdrive.autoOpen") ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Recent folder",
        `<input id="setMdriveRecent" type="text" value="${escapeAttr(get("mdrive.recentFolder", ""))}">`
      ) +
      fieldRow(
        "Cloud sync",
        `<label class="settings-switch"><input id="setMdriveSync" type="checkbox"${get("mdrive.syncEnabled") ? " checked" : ""} disabled><span></span></label>`,
        "Future sync placeholder"
      )
    );
  }

  function renderAdvanced() {
    return (
      fieldRow(
        "Hardware acceleration",
        `<label class="settings-switch"><input id="setHwAccel" type="checkbox"${get("advanced.hardwareAcceleration", true) ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Experimental features",
        `<label class="settings-switch"><input id="setExperimental" type="checkbox"${get("advanced.experimentalFeatures") ? " checked" : ""}><span></span></label>`
      ) +
      fieldRow(
        "Verbose logging",
        `<label class="settings-switch"><input id="setVerbose" type="checkbox"${get("advanced.verboseLogging") ? " checked" : ""}><span></span></label>`
      ) +
      `<div class="settings-actions">
        <button type="button" class="danger" id="setResetAll">Reset all settings</button>
      </div>`
    );
  }

  function renderAbout() {
    const info = aboutInfo || {};
    return (
      `<div class="settings-about">
        <div class="settings-about-brand">MBrowser</div>
        <div class="settings-about-row"><span>Version</span><strong>${escapeAttr(info.mbrowserVersion || "1.0.0")}</strong></div>
        <div class="settings-about-row"><span>Current Stable Commit</span><strong>${escapeAttr(info.stableCommit || "9d8da19")}</strong></div>
        <div class="settings-about-row"><span>Electron</span><strong>${escapeAttr(info.electron || "-")}</strong></div>
        <div class="settings-about-row"><span>Chrome</span><strong>${escapeAttr(info.chrome || "-")}</strong></div>
        <div class="settings-about-row"><span>Node</span><strong>${escapeAttr(info.node || "-")}</strong></div>
        <div class="settings-about-row"><span>Operating System</span><strong>${escapeAttr((info.osType || "") + " " + (info.osRelease || "") + " (" + (info.arch || "") + ")")}</strong></div>
      </div>`
    );
  }

  function escapeAttr(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindAuto(id, buildPatch) {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color" ? "change" : "change";
    el.addEventListener(eventName, async () => {
      const patch = buildPatch(el);
      if (patch) await savePatch(patch);
    });
    if (el.tagName === "INPUT" && (el.type === "text" || el.type === "number")) {
      el.addEventListener("blur", async () => {
        const patch = buildPatch(el);
        if (patch) await savePatch(patch);
      });
    }
  }

  function bindSectionHandlers(sectionId) {
    if (sectionId === "general") {
      bindAuto("setBrowserName", (el) => ({ general: { browserName: el.value.trim() || "MBrowser" } }));
      bindAuto("setHomepage", (el) => ({ general: { homepage: el.value.trim() || "mbrowser://home" } }));
      bindAuto("setNewTabBehavior", (el) => ({ general: { newTabBehavior: el.value } }));
      bindAuto("setDefaultZoom", (el) => ({ general: { defaultZoom: Number(el.value) || 100 } }));
    }

    if (sectionId === "appearance") {
      bindAuto("setTheme", (el) => ({ appearance: { theme: el.value } }));
      bindAuto("setAccent", (el) => ({ appearance: { accentColor: el.value } }));
      bindAuto("setCompact", (el) => ({ appearance: { compactMode: !!el.checked } }));
      bindAuto("setShowBmBar", (el) => ({
        appearance: { showBookmarksBar: !!el.checked },
        bookmarks: { showBookmarksBar: !!el.checked }
      }));
      bindAuto("setShowStatus", (el) => ({ appearance: { showStatusBar: !!el.checked } }));
    }

    if (sectionId === "startup") {
      bindAuto("setStartupMode", (el) => ({ startup: { mode: el.value } }));
    }

    if (sectionId === "search") {
      bindAuto("setSearchProvider", (el) => ({ searchEngine: { provider: el.value } }));
      bindAuto("setCustomSearch", (el) => ({ searchEngine: { customSearchUrl: el.value.trim() } }));
    }

    if (sectionId === "downloads") {
      bindAuto("setAskDownload", (el) => ({ downloads: { askBeforeDownload: !!el.checked } }));
      bindAuto("setAutoOpenDownloads", (el) => ({ downloads: { autoOpenDownloads: !!el.checked } }));
      bindAuto("setDownloadNotify", (el) => ({ downloads: { showNotifications: !!el.checked } }));
      const pick = document.getElementById("setPickDownloadFolder");
      if (pick) {
        pick.addEventListener("click", async () => {
          const bridge = ensureApi();
          if (!bridge) return;
          const result = await bridge.settingsPickDownloadFolder();
          if (result && result.canceled) return;
          if (result && result.success && result.data) {
            store = result.data;
            renderActiveSection();
          } else if (result && !result.success) {
            alert(result.error || "Could not update download folder.");
          }
        });
      }
      const openDl = document.getElementById("setOpenDownloadsManager");
      if (openDl) {
        openDl.addEventListener("click", () => {
          closeManager();
          if (window.Downloads) Downloads.openManager();
        });
      }
    }

    if (sectionId === "privacy") {
      bindAuto("setDnt", (el) => ({ privacy: { doNotTrack: !!el.checked } }));
      bindAuto("setOfferSavePasswords", (el) => ({ privacy: { offerToSavePasswords: !!el.checked } }));
      bindAuto("setEnableLoginDetection", (el) => ({ privacy: { enableLoginDetection: !!el.checked } }));
      bindAuto("setOfferAutofillPasswords", (el) => ({ privacy: { offerToAutofillPasswords: !!el.checked } }));
      ["setOfferSavePasswords", "setEnableLoginDetection"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("change", () => {
          if (window.LoginDetection && typeof LoginDetection.refreshSettingsFlags === "function") {
            LoginDetection.refreshSettingsFlags();
          }
        });
      });
      const offerAutofillEl = document.getElementById("setOfferAutofillPasswords");
      if (offerAutofillEl) {
        offerAutofillEl.addEventListener("change", () => {
          if (window.Autofill && typeof Autofill.refreshSettingsFlags === "function") {
            Autofill.refreshSettingsFlags();
          }
        });
      }
      const map = [
        ["setClearHistory", "history", "Clear all browsing history?"],
        ["setClearCache", "cache", "Clear cached files?"],
        ["setClearCookies", "cookies", "Clear cookies and site data?"],
        ["setClearDownloads", "downloads", "Clear download history?"]
      ];
      map.forEach(([id, target, message]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener("click", async () => {
          if (!confirm(message)) return;
          const bridge = ensureApi();
          if (!bridge) return;
          const result = await bridge.settingsClearPrivacy(target);
          if (!result || !result.success) {
            alert((result && result.error) || "Clear failed.");
            return;
          }
          if (target === "history" && window.History && typeof History.clearAll === "function") {
            // store already cleared in main; refresh history UI store if open
            try {
              await window.electronAPI.historyGet();
            } catch (e) {}
          }
          alert("Done.");
        });
      });
    }

    if (sectionId === "bookmarks") {
      bindAuto("setBmShowBar", (el) => ({
        appearance: { showBookmarksBar: !!el.checked },
        bookmarks: { showBookmarksBar: !!el.checked }
      }));
      const openMgr = document.getElementById("setBmOpenManager");
      if (openMgr) {
        openMgr.addEventListener("click", () => {
          closeManager();
          if (window.Bookmarks) Bookmarks.openManager();
        });
      }
      const imp = document.getElementById("setBmImport");
      if (imp) {
        imp.addEventListener("click", () => {
          if (window.Bookmarks) Bookmarks.importHtml();
        });
      }
      const exp = document.getElementById("setBmExport");
      if (exp) {
        exp.addEventListener("click", () => {
          if (window.Bookmarks) Bookmarks.exportHtml();
        });
      }
    }

    if (sectionId === "history") {
      bindAuto("setHistRetention", (el) => ({ history: { retentionDays: Number(el.value) || 90 } }));
      bindAuto("setHistMax", (el) => ({ history: { maxEntries: Number(el.value) || 10000 } }));
      const openHist = document.getElementById("setHistOpenManager");
      if (openHist) {
        openHist.addEventListener("click", () => {
          closeManager();
          if (window.History) History.openManager();
        });
      }
    }

    if (sectionId === "mdrive") {
      bindAuto("setMdriveWorkspace", (el) => ({ mdrive: { defaultWorkspace: el.value.trim() || "mdrive" } }));
      bindAuto("setMdriveAutoOpen", (el) => ({ mdrive: { autoOpen: !!el.checked } }));
      bindAuto("setMdriveRecent", (el) => ({ mdrive: { recentFolder: el.value.trim() } }));
    }

    if (sectionId === "advanced") {
      bindAuto("setHwAccel", (el) => ({ advanced: { hardwareAcceleration: !!el.checked } }));
      bindAuto("setExperimental", (el) => ({ advanced: { experimentalFeatures: !!el.checked } }));
      bindAuto("setVerbose", (el) => ({ advanced: { verboseLogging: !!el.checked } }));
      const reset = document.getElementById("setResetAll");
      if (reset) {
        reset.addEventListener("click", async () => {
          if (!confirm("Reset all settings to defaults?")) return;
          const bridge = ensureApi();
          if (!bridge) return;
          const result = await bridge.settingsReset();
          if (result && result.success) {
            store = result.data;
            applyRuntimeEffects({});
            renderActiveSection();
          }
        });
      }
    }
  }

  async function openManager(section) {
    const manager = document.getElementById("settingsManager");
    if (!manager) return;
    await refreshStore();
    if (section) activeSection = section;
    const bridge = ensureApi();
    if (bridge) {
      const about = await bridge.settingsGetAbout();
      if (about && about.success) aboutInfo = about.data;
    }
    manager.classList.add("open");
    renderNav();
    renderActiveSection();
    const search = document.getElementById("settingsSearchInput");
    if (search) search.focus();
  }

  function closeManager() {
    const manager = document.getElementById("settingsManager");
    if (manager) manager.classList.remove("open");
  }

  function onSearchInput(value) {
    searchQuery = value || "";
    renderNav();
  }

  async function init() {
    await refreshStore();
    applyRuntimeEffects({});

    if (window.matchMedia) {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (get("appearance.theme", "system") === "system") applyTheme();
      };
      if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", onChange);
      else if (mediaQuery.addListener) mediaQuery.addListener(onChange);
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeManager();
    });

    // Startup behaviour after settings loaded
    handleStartup();

    if (get("mdrive.autoOpen") && typeof openApp === "function") {
      setTimeout(() => openApp("mdrive"), 400);
    }
  }

  return {
    init,
    openManager,
    closeManager,
    onSearchInput,
    get,
    savePatch,
    buildSearchUrl,
    shouldShowBookmarksBar,
    getHomepage,
    getNewTabBehavior,
    getStartupMode,
    handleNewTab,
    openHomepage,
    applyBookmarksBarVisibility,
    reloadAndApply,
    SEARCH_PROVIDERS
  };
})();

window.Settings = Settings;
