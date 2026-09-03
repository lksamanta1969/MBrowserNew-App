/**
 * MBrowser Password Storage Engine (Phase 1E-A)
 * Manual CRUD manager with search. Vault encryption UI (Phase 1E-D.2).
 */

const Passwords = (function () {
  let store = { entries: [] };
  let searchQuery = "";
  let revealedIds = new Set();
  let vaultStatus = {
    mode: "legacy",
    unlocked: false,
    encryptedVaultPresent: false,
    legacyVaultPresent: true,
    errorCode: null,
    migrationState: "none",
    legacyEntryCount: 0,
    canMigrate: false
  };
  let vaultDialogMode = "setup";

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.passwordsGet !== "function") {
      console.warn("[Passwords] electronAPI not available");
      return null;
    }
    return bridge;
  }

  function isEncryptedVaultLockedForCrud() {
    return vaultStatus.migrationState === "complete" && !vaultStatus.unlocked;
  }

  function clearRendererCredentialStore() {
    store = { entries: [] };
    revealedIds = new Set();
    renderManager();
  }

  function vaultStatusLabel(mode, unlocked) {
    switch (mode) {
      case "setup_required":
        return "Vault: setup required";
      case "legacy":
        return "Vault: not encrypted yet";
      case "legacy_with_vault":
        return unlocked ? "Vault: unlocked (migration pending)" : "Vault: locked (migration pending)";
      case "encrypted_locked":
        return vaultStatus.migrationState === "complete"
          ? "Vault: locked (encrypted)"
          : "Vault: locked";
      case "encrypted_unlocked":
        return vaultStatus.migrationState === "complete"
          ? "Vault: unlocked (encrypted)"
          : "Vault: unlocked";
      case "encrypted_error":
        return "Vault: error";
      default:
        return "Vault: unknown";
    }
  }

  async function refreshVaultStatus() {
    const bridge = ensureApi();
    if (!bridge || typeof bridge.vaultStatus !== "function") return vaultStatus;

    const result = await bridge.vaultStatus();
    if (result && result.success && result.data) {
      vaultStatus = {
        mode: result.data.mode || "legacy",
        unlocked: !!result.data.unlocked,
        encryptedVaultPresent: !!result.data.encryptedVaultPresent,
        legacyVaultPresent: !!result.data.legacyVaultPresent,
        errorCode: result.data.errorCode || null,
        migrationState: result.data.migrationState || "none",
        legacyEntryCount: Number(result.data.legacyEntryCount || 0),
        canMigrate: !!result.data.canMigrate
      };
    }
    return vaultStatus;
  }

  function renderVaultStatusBar() {
    const textEl = document.getElementById("pwVaultStatusText");
    const setupBtn = document.getElementById("pwVaultSetupBtn");
    const unlockBtn = document.getElementById("pwVaultUnlockBtn");
    const lockBtn = document.getElementById("pwVaultLockBtn");
    const migrateBtn = document.getElementById("pwVaultMigrateBtn");
    if (!textEl) return;

    textEl.textContent = vaultStatusLabel(vaultStatus.mode, vaultStatus.unlocked);

    const mode = vaultStatus.mode;
    const unlocked = vaultStatus.unlocked;

    if (setupBtn) {
      setupBtn.hidden = !(mode === "setup_required" || mode === "legacy");
    }
    if (unlockBtn) {
      unlockBtn.hidden = !(
        (mode === "legacy_with_vault" || mode === "encrypted_locked") &&
        !unlocked
      );
    }
    if (lockBtn) {
      lockBtn.hidden = !(
        (mode === "legacy_with_vault" ||
          mode === "encrypted_unlocked") &&
        unlocked
      );
    }
    if (migrateBtn) {
      migrateBtn.hidden = !vaultStatus.canMigrate;
    }
  }

  function setMigrateDialogError(message) {
    const errorEl = document.getElementById("pwMigrateError");
    if (!errorEl) return;
    const text = String(message || "").trim();
    if (!text) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = text;
  }

  function openMigrateDialog() {
    const backdrop = document.getElementById("pwMigrateBackdrop");
    const hintEl = document.getElementById("pwMigrateHint");
    const passwordInput = document.getElementById("pwMigratePassword");
    if (!backdrop || !passwordInput) return;

    setMigrateDialogError("");
    if (hintEl) {
      const count = vaultStatus.legacyEntryCount || 0;
      hintEl.textContent =
        `Migrate ${count} saved credential${count === 1 ? "" : "s"} into the encrypted vault. ` +
        "The active plaintext passwords.json file will be retired after verification, and a verified backup will be kept.";
    }
    passwordInput.value = "";
    backdrop.classList.add("open");
    setTimeout(() => passwordInput.focus(), 50);
  }

  function closeMigrateDialog() {
    const backdrop = document.getElementById("pwMigrateBackdrop");
    if (backdrop) backdrop.classList.remove("open");
    setMigrateDialogError("");
    const passwordInput = document.getElementById("pwMigratePassword");
    if (passwordInput) passwordInput.value = "";
  }

  async function submitMigrateDialog() {
    const bridge = ensureApi();
    if (!bridge || typeof bridge.vaultMigrate !== "function") return;

    const passwordInput = document.getElementById("pwMigratePassword");
    const masterPassword = passwordInput ? passwordInput.value : "";
    setMigrateDialogError("");

    const result = await bridge.vaultMigrate({ masterPassword });
    if (passwordInput) passwordInput.value = "";

    if (!result || !result.success) {
      setMigrateDialogError((result && result.error) || "Migration failed.");
      return;
    }

    await refreshVaultStatus();
    renderVaultStatusBar();
    await refreshStore();
    renderManager();
    closeMigrateDialog();
  }

  function setVaultDialogError(message) {
    const errorEl = document.getElementById("pwVaultError");
    if (!errorEl) return;
    const text = String(message || "").trim();
    if (!text) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = text;
  }

  function openVaultDialog(mode) {
    const backdrop = document.getElementById("pwVaultBackdrop");
    const titleEl = document.getElementById("pwVaultTitle");
    const hintEl = document.getElementById("pwVaultHint");
    const confirmBlock = document.getElementById("pwVaultConfirmBlock");
    const passwordInput = document.getElementById("pwVaultPassword");
    const confirmInput = document.getElementById("pwVaultConfirm");
    const submitBtn = document.getElementById("pwVaultSubmitBtn");
    if (!backdrop || !passwordInput) return;

    vaultDialogMode = mode === "unlock" ? "unlock" : "setup";
    setVaultDialogError("");

    if (titleEl) {
      titleEl.textContent =
        vaultDialogMode === "unlock" ? "Unlock vault" : "Set up vault";
    }
    if (hintEl) {
      hintEl.textContent =
        vaultDialogMode === "unlock"
          ? "Enter your master password to unlock the encrypted vault."
          : "Create a master password to protect your encrypted vault. Your existing saved passwords stay in the legacy vault until migration.";
    }
    if (confirmBlock) {
      confirmBlock.style.display = vaultDialogMode === "setup" ? "block" : "none";
    }
    if (confirmInput) confirmInput.value = "";
    passwordInput.value = "";
    if (submitBtn) {
      submitBtn.textContent = vaultDialogMode === "unlock" ? "Unlock" : "Continue";
    }

    backdrop.classList.add("open");
    setTimeout(() => passwordInput.focus(), 50);
  }

  function openVaultSetupDialog() {
    openVaultDialog("setup");
  }

  function openVaultUnlockDialog() {
    openVaultDialog("unlock");
  }

  function closeVaultDialog() {
    const backdrop = document.getElementById("pwVaultBackdrop");
    if (backdrop) backdrop.classList.remove("open");
    setVaultDialogError("");
    const passwordInput = document.getElementById("pwVaultPassword");
    const confirmInput = document.getElementById("pwVaultConfirm");
    if (passwordInput) passwordInput.value = "";
    if (confirmInput) confirmInput.value = "";
  }

  async function submitVaultDialog() {
    const bridge = ensureApi();
    if (!bridge) return;

    const passwordInput = document.getElementById("pwVaultPassword");
    const confirmInput = document.getElementById("pwVaultConfirm");
    const masterPassword = passwordInput ? passwordInput.value : "";
    const confirmPassword = confirmInput ? confirmInput.value : "";

    setVaultDialogError("");

    let result;
    if (vaultDialogMode === "unlock") {
      if (typeof bridge.vaultUnlock !== "function") return;
      result = await bridge.vaultUnlock({ masterPassword });
    } else {
      if (typeof bridge.vaultSetup !== "function") return;
      result = await bridge.vaultSetup({ masterPassword, confirmPassword });
    }

    if (passwordInput) passwordInput.value = "";
    if (confirmInput) confirmInput.value = "";

    if (!result || !result.success) {
      setVaultDialogError((result && result.error) || "Vault operation failed.");
      return;
    }

    await refreshVaultStatus();
    renderVaultStatusBar();
    closeVaultDialog();
    if (vaultDialogMode === "unlock") {
      await refreshStore();
      renderManager();
    }
  }

  async function lockVault() {
    const bridge = ensureApi();
    if (!bridge || typeof bridge.vaultLock !== "function") return;

    const result = await bridge.vaultLock();
    if (!result || !result.success) {
      alert((result && result.error) || "Could not lock vault.");
      return;
    }

    await refreshVaultStatus();
    renderVaultStatusBar();
    closeFormDialog();
    clearRendererCredentialStore();
  }

  async function refreshStore() {
    const bridge = ensureApi();
    if (!bridge) return store;
    const result = await bridge.passwordsGet();
    if (result && result.success && result.data) {
      store = result.data;
      return store;
    }
    if (result && result.code === "VAULT_LOCKED") {
      store = { entries: [] };
      revealedIds = new Set();
      renderManager();
    }
    return store;
  }

  function applyStore(data) {
    if (data) store = data;
    revealedIds = new Set(
      [...revealedIds].filter((id) =>
        (store.entries || []).some((entry) => entry.id === id)
      )
    );
    renderManager();
  }

  function applyExternalData(data) {
    applyStore(data);
  }

  async function refresh() {
    await refreshStore();
    renderManager();
    return store;
  }

  function escapeAttr(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function maskPassword(value) {
    const len = String(value || "").length;
    if (!len) return "—";
    return "•".repeat(Math.min(12, Math.max(6, len)));
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getFilteredEntries() {
    const query = searchQuery.trim().toLowerCase();
    return (store.entries || [])
      .filter((entry) => {
        if (!query) return true;
        return (
          String(entry.origin || "").toLowerCase().includes(query) ||
          String(entry.url || "").toLowerCase().includes(query) ||
          String(entry.username || "").toLowerCase().includes(query) ||
          String(entry.notes || "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }

  function renderManager() {
    const manager = document.getElementById("passwordManager");
    if (!manager || !manager.classList.contains("open")) return;

    const heading = document.getElementById("pwListHeading");
    const list = document.getElementById("pwList");
    if (!list) return;

    const entries = getFilteredEntries();
    if (heading) heading.textContent = `Saved passwords (${entries.length})`;
    list.innerHTML = "";

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "pw-list-empty";
      empty.textContent = searchQuery
        ? "No passwords match your search."
        : "No saved passwords yet.";
      list.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "pw-row";

      const revealed = revealedIds.has(entry.id);
      const site = entry.origin || entry.url || "Unknown site";

      row.innerHTML =
        `<div class="pw-row-main">` +
        `<div class="pw-site">${escapeAttr(site)}</div>` +
        `<div class="pw-username">${escapeAttr(entry.username || "")}</div>` +
        `<div class="pw-password-line">` +
        `<span class="pw-password-value">${
          revealed ? escapeAttr(entry.password || "") : escapeAttr(maskPassword(entry.password))
        }</span>` +
        `</div>` +
        `<div class="pw-meta">Updated ${escapeAttr(formatDate(entry.updatedAt || entry.createdAt))}</div>` +
        (entry.notes
          ? `<div class="pw-notes">${escapeAttr(entry.notes)}</div>`
          : "") +
        `</div>`;

      const actions = document.createElement("div");
      actions.className = "pw-actions";

      const addBtn = (label, className, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        if (className) btn.className = className;
        btn.addEventListener("click", onClick);
        actions.appendChild(btn);
      };

      addBtn(revealed ? "Hide" : "Show", "", () => {
        if (revealedIds.has(entry.id)) revealedIds.delete(entry.id);
        else revealedIds.add(entry.id);
        renderManager();
      });
      addBtn("Copy user", "", async () => {
        try {
          const bridge = ensureApi();
          if (bridge && typeof bridge.clipboardWriteText === "function") {
            const result = await bridge.clipboardWriteText(entry.username || "");
            if (!result || !result.success) throw new Error((result && result.error) || "copy failed");
          } else {
            await navigator.clipboard.writeText(entry.username || "");
          }
        } catch (e) {
          alert("Could not copy username.");
        }
      });
      addBtn("Copy pass", "", async () => {
        try {
          const bridge = ensureApi();
          if (bridge && typeof bridge.clipboardWriteText === "function") {
            const result = await bridge.clipboardWriteText(entry.password || "");
            if (!result || !result.success) throw new Error((result && result.error) || "copy failed");
          } else {
            await navigator.clipboard.writeText(entry.password || "");
          }
        } catch (e) {
          alert("Could not copy password.");
        }
      });
      addBtn("Edit", "primary", () => openFormDialog({ mode: "edit", entry }));
      addBtn("Delete", "danger", () => deleteEntry(entry.id));

      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function openFormDialog(state) {
    if (isEncryptedVaultLockedForCrud()) return;

    const backdrop = document.getElementById("pwFormBackdrop");
    const titleEl = document.getElementById("pwFormTitle");
    const urlInput = document.getElementById("pwFormUrl");
    const userInput = document.getElementById("pwFormUsername");
    const passInput = document.getElementById("pwFormPassword");
    const notesInput = document.getElementById("pwFormNotes");
    const deleteBtn = document.getElementById("pwFormDeleteBtn");
    if (!backdrop || !urlInput || !userInput || !passInput) return;

    const entry = state.entry || {};
    titleEl.textContent = state.mode === "edit" ? "Edit password" : "Add password";
    urlInput.value = entry.url || entry.origin || "";
    userInput.value = entry.username || "";
    passInput.value = entry.password || "";
    passInput.type = "password";
    if (notesInput) notesInput.value = entry.notes || "";
    backdrop.dataset.mode = state.mode;
    backdrop.dataset.id = entry.id || "";
    if (deleteBtn) {
      deleteBtn.style.display = state.mode === "edit" ? "inline-flex" : "none";
    }

    backdrop.classList.add("open");
    setTimeout(() => urlInput.focus(), 50);
  }

  function closeFormDialog() {
    const backdrop = document.getElementById("pwFormBackdrop");
    if (backdrop) backdrop.classList.remove("open");
  }

  function toggleFormPasswordVisibility() {
    const passInput = document.getElementById("pwFormPassword");
    if (!passInput) return;
    passInput.type = passInput.type === "password" ? "text" : "password";
  }

  async function saveForm() {
    const bridge = ensureApi();
    if (!bridge) return;
    if (isEncryptedVaultLockedForCrud()) return;

    const backdrop = document.getElementById("pwFormBackdrop");
    const urlInput = document.getElementById("pwFormUrl");
    const userInput = document.getElementById("pwFormUsername");
    const passInput = document.getElementById("pwFormPassword");
    const notesInput = document.getElementById("pwFormNotes");

    const url = (urlInput.value || "").trim();
    const username = (userInput.value || "").trim();
    const password = passInput.value || "";
    const notes = notesInput ? (notesInput.value || "").trim() : "";

    if (!url) {
      alert("Site URL is required.");
      return;
    }
    if (!username) {
      alert("Username is required.");
      return;
    }

    let result;
    if (backdrop.dataset.mode === "edit") {
      result = await bridge.passwordsUpdate({
        id: backdrop.dataset.id,
        url,
        username,
        password,
        notes
      });
    } else {
      result = await bridge.passwordsAdd({
        url,
        username,
        password,
        notes
      });
    }

    if (!result || !result.success) {
      alert((result && result.error) || "Could not save password.");
      return;
    }

    applyStore(result.data);
    closeFormDialog();
  }

  async function deleteEntry(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    if (isEncryptedVaultLockedForCrud()) return;
    if (!confirm("Delete this saved password?")) return;
    const result = await bridge.passwordsDelete({ id });
    if (!result || !result.success) {
      alert((result && result.error) || "Could not delete password.");
      return;
    }
    applyStore(result.data);
    closeFormDialog();
  }

  async function deleteFromForm() {
    const backdrop = document.getElementById("pwFormBackdrop");
    if (!backdrop || backdrop.dataset.mode !== "edit" || !backdrop.dataset.id) return;
    await deleteEntry(backdrop.dataset.id);
  }

  async function clearAll() {
    const bridge = ensureApi();
    if (!bridge) return;
    if (isEncryptedVaultLockedForCrud()) return;
    if (!confirm("Delete all saved passwords? This cannot be undone.")) return;
    const result = await bridge.passwordsClear();
    if (!result || !result.success) {
      alert((result && result.error) || "Could not clear passwords.");
      return;
    }
    applyStore(result.data);
  }

  function onSearchInput(value) {
    searchQuery = value || "";
    renderManager();
  }

  function openAddDialog() {
    if (isEncryptedVaultLockedForCrud()) return;
    openFormDialog({ mode: "add", entry: {} });
  }

  async function openManager() {
    const manager = document.getElementById("passwordManager");
    if (!manager) return;
    await refreshVaultStatus();
    renderVaultStatusBar();
    await refreshStore();
    manager.classList.add("open");
    renderManager();
    if (vaultStatus.mode === "setup_required") {
      openVaultSetupDialog();
    }
    const search = document.getElementById("pwSearchInput");
    if (search) search.focus();
  }

  function closeManager() {
    const manager = document.getElementById("passwordManager");
    if (manager) manager.classList.remove("open");
    closeFormDialog();
    closeVaultDialog();
    closeMigrateDialog();
  }

  async function init() {
    await refreshStore();
    await refreshVaultStatus();
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const vault = document.getElementById("pwVaultBackdrop");
      if (vault && vault.classList.contains("open")) {
        closeVaultDialog();
        return;
      }
      const migrate = document.getElementById("pwMigrateBackdrop");
      if (migrate && migrate.classList.contains("open")) {
        closeMigrateDialog();
        return;
      }
      const form = document.getElementById("pwFormBackdrop");
      if (form && form.classList.contains("open")) {
        closeFormDialog();
        return;
      }
      closeManager();
    });
  }

  return {
    init,
    openManager,
    closeManager,
    onSearchInput,
    openAddDialog,
    openFormDialog,
    closeFormDialog,
    saveForm,
    deleteFromForm,
    toggleFormPasswordVisibility,
    clearAll,
    applyExternalData,
    refresh,
    openVaultSetupDialog,
    openVaultUnlockDialog,
    closeVaultDialog,
    submitVaultDialog,
    lockVault,
    openMigrateDialog,
    closeMigrateDialog,
    submitMigrateDialog
  };
})();

window.Passwords = Passwords;
