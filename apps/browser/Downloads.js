/**
 * MBrowser Download Manager
 * Live download list with search, filters, and actions.
 */

const Downloads = (function () {
  let store = { items: [] };
  let searchQuery = "";
  let activeFilter = "all";
  let unsubscribeChanged = null;
  let unsubscribeProgress = null;

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.downloadsGet !== "function") {
      console.warn("[Downloads] electronAPI not available");
      return null;
    }
    return bridge;
  }

  async function refreshStore() {
    const bridge = ensureApi();
    if (!bridge) return store;
    const result = await bridge.downloadsGet();
    if (result && result.success && result.data) store = result.data;
    return store;
  }

  function applyStore(data) {
    if (data) store = data;
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

  function itemTime(item) {
    return item.endTime || item.startTime || 0;
  }

  function getFilteredItems() {
    const now = Date.now();
    const todayStart = startOfLocalDay(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const query = searchQuery.trim().toLowerCase();

    return (store.items || [])
      .filter((item) => {
        const ts = itemTime(item);
        switch (activeFilter) {
          case "active":
            if (!["downloading", "paused", "interrupted"].includes(item.status)) return false;
            break;
          case "completed":
            if (item.status !== "completed") return false;
            break;
          case "failed":
            if (!["failed", "interrupted"].includes(item.status)) return false;
            break;
          case "cancelled":
            if (item.status !== "cancelled") return false;
            break;
          case "today":
            if (ts < todayStart) return false;
            break;
          case "last7":
            if (ts < todayStart - 6 * dayMs) return false;
            break;
          case "lastMonth":
            if (ts < todayStart - 29 * dayMs) return false;
            break;
          case "all":
          default:
            break;
        }

        if (!query) return true;
        return (
          String(item.fileName || "").toLowerCase().includes(query) ||
          String(item.url || "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => itemTime(b) - itemTime(a));
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function formatSpeed(bps) {
    if (!bps) return "";
    return formatBytes(bps) + "/s";
  }

  function formatEta(item) {
    const speed = Number(item.speed) || 0;
    const total = Number(item.fileSize) || 0;
    const got = Number(item.downloadedBytes) || 0;
    if (!speed || !total || got >= total) return "";
    const remain = Math.max(0, total - got);
    const seconds = Math.round(remain / speed);
    if (seconds < 60) return seconds + "s left";
    if (seconds < 3600) return Math.round(seconds / 60) + "m left";
    return Math.round(seconds / 3600) + "h left";
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

  function statusLabel(status) {
    const map = {
      downloading: "Downloading",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      interrupted: "Interrupted",
      paused: "Paused"
    };
    return map[status] || status || "Unknown";
  }

  function renderFilters() {
    document.querySelectorAll("[data-dl-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-dl-filter") === activeFilter);
    });
  }

  function renderManager() {
    const manager = document.getElementById("downloadsManager");
    if (!manager || !manager.classList.contains("open")) return;

    renderFilters();
    const list = document.getElementById("dlList");
    const heading = document.getElementById("dlListHeading");
    if (!list) return;

    const items = getFilteredItems();
    if (heading) heading.textContent = `Downloads (${items.length})`;
    list.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "dl-list-empty";
      empty.textContent = searchQuery
        ? "No downloads match your search."
        : "No downloads in this view.";
      list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "dl-row status-" + (item.status || "unknown");

      const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
      const metaBits = [
        statusLabel(item.status),
        formatBytes(item.downloadedBytes) + (item.fileSize ? " / " + formatBytes(item.fileSize) : ""),
        item.speed ? formatSpeed(item.speed) : "",
        formatEta(item),
        formatDate(itemTime(item))
      ].filter(Boolean);

      row.innerHTML =
        `<div class="dl-row-main">` +
        `<div class="dl-file-name">${escapeAttr(item.fileName || "download")}</div>` +
        `<div class="dl-file-url">${escapeAttr(item.url || "")}</div>` +
        `<div class="dl-progress-track"><div class="dl-progress-bar" style="width:${progress}%"></div></div>` +
        `<div class="dl-file-meta"><span>${progress}%</span><span>${escapeAttr(metaBits.join(" · "))}</span></div>` +
        (item.errorMessage && item.status !== "completed"
          ? `<div class="dl-error">${escapeAttr(item.errorMessage)}</div>`
          : "") +
        `</div>`;

      const actions = document.createElement("div");
      actions.className = "dl-actions";

      const addBtn = (label, className, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        if (className) btn.className = className;
        btn.addEventListener("click", onClick);
        actions.appendChild(btn);
      };

      if (item.status === "downloading") {
        addBtn("Pause", "", () => pauseDownload(item.id));
        addBtn("Cancel", "danger", () => cancelDownload(item.id));
      } else if (item.status === "paused" || item.status === "interrupted") {
        addBtn("Resume", "", () => resumeDownload(item.id));
        addBtn("Cancel", "danger", () => cancelDownload(item.id));
      }

      if (item.status === "completed") {
        addBtn("Open", "primary", () => openFile(item.id));
        addBtn("Folder", "", () => showInFolder(item.id));
      }

      if (["failed", "cancelled", "interrupted"].includes(item.status)) {
        addBtn("Retry", "primary", () => retryDownload(item.id));
      }

      addBtn("Remove", "danger", () => removeRecord(item.id));

      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  async function cancelDownload(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    const result = await bridge.downloadsCancel(id);
    if (!result || !result.success) alert((result && result.error) || "Could not cancel download.");
  }

  async function pauseDownload(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    const result = await bridge.downloadsPause(id);
    if (!result || !result.success) alert((result && result.error) || "Could not pause download.");
  }

  async function resumeDownload(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    const result = await bridge.downloadsResume(id);
    if (!result || !result.success) alert((result && result.error) || "Could not resume download.");
  }

  async function retryDownload(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    const result = await bridge.downloadsRetry(id);
    if (!result || !result.success) alert((result && result.error) || "Could not retry download.");
  }

  async function openFile(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    const result = await bridge.downloadsOpenFile(id);
    if (!result || !result.success) alert((result && result.error) || "Could not open file.");
  }

  async function showInFolder(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    const result = await bridge.downloadsShowInFolder(id);
    if (!result || !result.success) alert((result && result.error) || "Could not open folder.");
  }

  async function removeRecord(id) {
    const bridge = ensureApi();
    if (!bridge) return;
    if (!confirm("Remove this download from the list? The file will not be deleted.")) return;
    const result = await bridge.downloadsDelete({ id });
    if (!result || !result.success) {
      alert((result && result.error) || "Could not remove download.");
      return;
    }
    applyStore(result.data);
  }

  async function clearCompleted() {
    const bridge = ensureApi();
    if (!bridge) return;
    if (!confirm("Clear all completed downloads from the list?")) return;
    const result = await bridge.downloadsClear("completed");
    if (!result || !result.success) {
      alert((result && result.error) || "Could not clear completed downloads.");
      return;
    }
    applyStore(result.data);
  }

  async function clearAll() {
    const bridge = ensureApi();
    if (!bridge) return;
    if (!confirm("Clear all download history from the list? Files will not be deleted.")) return;
    const result = await bridge.downloadsClear("all");
    if (!result || !result.success) {
      alert((result && result.error) || "Could not clear downloads.");
      return;
    }
    applyStore(result.data);
  }

  function setFilter(filter) {
    activeFilter = filter || "all";
    renderManager();
  }

  function onSearchInput(value) {
    searchQuery = value || "";
    renderManager();
  }

  async function openManager() {
    const manager = document.getElementById("downloadsManager");
    if (!manager) return;
    await refreshStore();
    manager.classList.add("open");
    renderManager();
    const search = document.getElementById("dlSearchInput");
    if (search) search.focus();
  }

  function closeManager() {
    const manager = document.getElementById("downloadsManager");
    if (manager) manager.classList.remove("open");
  }

  async function init() {
    await refreshStore();
    const bridge = ensureApi();
    if (!bridge) return;

    if (typeof bridge.onDownloadsChanged === "function") {
      unsubscribeChanged = bridge.onDownloadsChanged((payload) => {
        if (payload && payload.data) applyStore(payload.data);
        else refreshStore().then(() => renderManager());
      });
    }

    if (typeof bridge.onDownloadsProgress === "function") {
      unsubscribeProgress = bridge.onDownloadsProgress((patch) => {
        if (!patch || !patch.id) return;
        const index = (store.items || []).findIndex((item) => item.id === patch.id);
        if (index >= 0) store.items[index] = { ...store.items[index], ...patch };
        else store.items = [{ ...patch }, ...(store.items || [])];
        renderManager();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeManager();
    });
  }

  return {
    init,
    openManager,
    closeManager,
    setFilter,
    onSearchInput,
    clearCompleted,
    clearAll,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    retryDownload,
    openFile,
    showInFolder,
    removeRecord
  };
})();

window.Downloads = Downloads;
