/**
 * MBrowser Password Storage Engine (Phase 1E-A)
 * Manual CRUD manager with search. No autofill / encryption yet.
 */

const Passwords = (function () {
  let store = { entries: [] };
  let searchQuery = "";
  let revealedIds = new Set();

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.passwordsGet !== "function") {
      console.warn("[Passwords] electronAPI not available");
      return null;
    }
    return bridge;
  }

  async function refreshStore() {
    const bridge = ensureApi();
    if (!bridge) return store;
    const result = await bridge.passwordsGet();
    if (result && result.success && result.data) store = result.data;
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
    openFormDialog({ mode: "add", entry: {} });
  }

  async function openManager() {
    const manager = document.getElementById("passwordManager");
    if (!manager) return;
    await refreshStore();
    manager.classList.add("open");
    renderManager();
    const search = document.getElementById("pwSearchInput");
    if (search) search.focus();
  }

  function closeManager() {
    const manager = document.getElementById("passwordManager");
    if (manager) manager.classList.remove("open");
    closeFormDialog();
  }

  async function init() {
    await refreshStore();
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
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
    clearAll
  };
})();

window.Passwords = Passwords;
