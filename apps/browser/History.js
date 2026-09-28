/**
 * MBrowser History Manager
 * Auto-records visits; manager overlay with search, filters, and delete.
 */

const History = (function () {
  let store = { entries: [] };
  let searchQuery = "";
  let activeFilter = "all";
  let selectedIds = new Set();

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.historyGet !== "function") {
      console.warn("[History] electronAPI not available");
      return null;
    }
    return bridge;
  }

  async function refreshStore() {
    const bridge = ensureApi();
    if (!bridge) return store;

    const result = await bridge.historyGet();
    if (result && result.success && result.data) {
      store = result.data;
    }
    return store;
  }

  function applyStore(data) {
    if (data) store = data;
    selectedIds = new Set(
      [...selectedIds].filter((id) =>
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

  function startOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function endOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  function getFilterBounds(filter) {
    const now = Date.now();
    const todayStart = startOfLocalDay(now);
    const todayEnd = endOfLocalDay(now);
    const dayMs = 24 * 60 * 60 * 1000;

    switch (filter) {
      case "today":
        return { from: todayStart, to: todayEnd };
      case "yesterday":
        return { from: todayStart - dayMs, to: todayStart - 1 };
      case "last7":
        return { from: todayStart - 6 * dayMs, to: todayEnd };
      case "lastMonth":
        return { from: todayStart - 29 * dayMs, to: todayEnd };
      case "all":
      default:
        return { from: 0, to: Number.MAX_SAFE_INTEGER };
    }
  }

  function entryTimestamp(entry) {
    return entry.lastVisited || entry.visitTime || 0;
  }

  function getFilteredEntries() {
    const bounds = getFilterBounds(activeFilter);
    const query = searchQuery.trim().toLowerCase();

    return (store.entries || [])
      .filter((entry) => {
        const ts = entryTimestamp(entry);
        if (ts < bounds.from || ts > bounds.to) return false;
        if (!query) return true;
        return (
          String(entry.title || "").toLowerCase().includes(query) ||
          String(entry.url || "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
  }

  function formatVisitTime(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function openHistoryUrl(url) {
    if (!url) return;
    const urlInput = document.getElementById("url");
    if (urlInput) urlInput.value = url;
    if (typeof loadSite === "function") loadSite();
    closeManager();
  }

  function renderFilterButtons() {
    document.querySelectorAll("[data-hist-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-hist-filter") === activeFilter);
    });
  }

  function renderManager() {
    const manager = document.getElementById("historyManager");
    if (!manager || !manager.classList.contains("open")) return;

    renderFilterButtons();

    const heading = document.getElementById("histListHeading");
    const list = document.getElementById("histList");
    const selectAll = document.getElementById("histSelectAll");
    if (!list) return;

    const entries = getFilteredEntries();
    if (heading) {
      heading.textContent = `History (${entries.length})`;
    }

    list.innerHTML = "";

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "hist-list-empty";
      empty.textContent = searchQuery
        ? "No matching history entries."
        : "No browsing history in this range.";
      list.appendChild(empty);
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }

    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "hist-list-row";
      if (selectedIds.has(entry.id)) row.classList.add("selected");

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "hist-row-check";
      check.checked = selectedIds.has(entry.id);
      check.addEventListener("click", (e) => e.stopPropagation());
      check.addEventListener("change", () => {
        if (check.checked) selectedIds.add(entry.id);
        else selectedIds.delete(entry.id);
        renderManager();
      });

      const main = document.createElement("button");
      main.type = "button";
      main.className = "hist-list-main";
      main.innerHTML =
        `<div class="hist-list-title">${escapeAttr(entry.title || entry.url)}</div>` +
        `<div class="hist-list-url">${escapeAttr(entry.url)}</div>` +
        `<div class="hist-list-meta">Last visited: ${escapeAttr(formatVisitTime(entry.lastVisited))} · Visits: ${entry.visitCount || 1}</div>`;
      main.addEventListener("click", () => openHistoryUrl(entry.url));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteEntries([entry.id]);
      });

      row.appendChild(check);
      row.appendChild(main);
      row.appendChild(delBtn);
      list.appendChild(row);
    });

    if (selectAll) {
      const selectedVisible = entries.filter((e) => selectedIds.has(e.id)).length;
      selectAll.checked = selectedVisible > 0 && selectedVisible === entries.length;
      selectAll.indeterminate = selectedVisible > 0 && selectedVisible < entries.length;
    }
  }

  async function recordVisit(url, title) {
    const bridge = ensureApi();
    if (!bridge) return;

    const cleanUrl = String(url || "").trim();
    if (!cleanUrl || cleanUrl === "about:blank") return;

    const result = await bridge.historyRecord({
      url: cleanUrl,
      title: title || cleanUrl,
      visitTime: Date.now()
    });

    if (result && result.success && result.data) {
      store = result.data;
      const manager = document.getElementById("historyManager");
      if (manager && manager.classList.contains("open")) renderManager();
    }
  }

  async function updateTitle(url, title) {
    const bridge = ensureApi();
    if (!bridge) return;

    const cleanUrl = String(url || "").trim();
    const cleanTitle = String(title || "").trim();
    if (!cleanUrl || !cleanTitle) return;

    const result = await bridge.historyUpdateTitle({
      url: cleanUrl,
      title: cleanTitle
    });

    if (result && result.success && result.data) {
      store = result.data;
      const manager = document.getElementById("historyManager");
      if (manager && manager.classList.contains("open")) renderManager();
    }
  }

  async function deleteEntries(ids) {
    const bridge = ensureApi();
    if (!bridge) return;

    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!list.length) return;

    if (!confirm(list.length === 1 ? "Delete this history entry?" : `Delete ${list.length} history entries?`)) {
      return;
    }

    const result = await bridge.historyDelete({ ids: list });
    if (!result || !result.success) {
      alert((result && result.error) || "Could not delete history.");
      return;
    }

    applyStore(result.data);
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) {
      alert("Select one or more history entries first.");
      return;
    }
    await deleteEntries(ids);
  }

  async function deleteRange(range, label) {
    const bridge = ensureApi();
    if (!bridge) return;

    const message =
      range === "all"
        ? "Clear all browsing history?"
        : `Delete history for ${label || range}?`;

    if (!confirm(message)) return;

    const result = await bridge.historyDeleteRange(range);
    if (!result || !result.success) {
      alert((result && result.error) || "Could not delete history range.");
      return;
    }

    selectedIds.clear();
    applyStore(result.data);
  }

  function setFilter(filter) {
    activeFilter = filter || "all";
    selectedIds.clear();
    renderManager();
  }

  function onSearchInput(value) {
    searchQuery = value || "";
    renderManager();
  }

  function toggleSelectAll(checked) {
    const entries = getFilteredEntries();
    if (checked) {
      entries.forEach((entry) => selectedIds.add(entry.id));
    } else {
      entries.forEach((entry) => selectedIds.delete(entry.id));
    }
    renderManager();
  }

  async function openManager() {
    const manager = document.getElementById("historyManager");
    if (!manager) return;
    await refreshStore();
    manager.classList.add("open");
    renderManager();
    const searchInput = document.getElementById("histSearchInput");
    if (searchInput) searchInput.focus();
  }

  function closeManager() {
    const manager = document.getElementById("historyManager");
    if (manager) manager.classList.remove("open");
  }

  async function init() {
    await refreshStore();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeManager();
    });
  }

  return {
    init,
    recordVisit,
    updateTitle,
    openManager,
    closeManager,
    setFilter,
    onSearchInput,
    toggleSelectAll,
    deleteSelected,
    deleteRange,
    deleteToday: () => deleteRange("today", "Today"),
    deleteYesterday: () => deleteRange("yesterday", "Yesterday"),
    clearAll: () => deleteRange("all", "All History")
  };
})();

window.History = History;
