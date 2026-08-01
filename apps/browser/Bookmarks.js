/**
 * MBrowser Bookmark Manager
 * Shell chrome: star, bookmarks bar, manager window, import/export.
 */

const Bookmarks = (function () {
  const BOOKMARKS_BAR_ID = "bookmarks_bar";
  const OTHER_BOOKMARKS_ID = "other";

  let store = { folders: [], bookmarks: [] };
  let selectedFolderId = BOOKMARKS_BAR_ID;
  let searchQuery = "";
  let openFolderMenuId = null;

  function ensureApi() {
    const bridge = window.electronAPI || null;
    if (!bridge || typeof bridge.bookmarksGet !== "function") {
      console.warn("[Bookmarks] electronAPI not available");
      return null;
    }
    return bridge;
  }

  async function refreshStore() {
    const bridge = ensureApi();
    if (!bridge) return store;

    const result = await bridge.bookmarksGet();
    if (result && result.success && result.data) {
      store = result.data;
    }
    return store;
  }

  function applyStore(data) {
    if (data) store = data;
    renderAll();
  }

  function getCurrentPage() {
    const urlInput = document.getElementById("url");
    const browser = document.getElementById("browser");
    let url = "";
    let title = "New Tab";

    if (typeof onHomePage !== "undefined" && onHomePage) {
      return { url: "", title: "New Tab", isHome: true };
    }

    try {
      if (browser && browser.getURL) {
        url = browser.getURL() || "";
      }
    } catch (e) {
      /* webview may not be ready */
    }

    if (!url && urlInput) {
      url = (urlInput.value || "").trim();
    }

    try {
      if (browser && browser.getTitle) {
        title = browser.getTitle() || title;
      }
    } catch (e) {
      /* ignore */
    }

    if (!title || title === "about:blank") {
      title = url || "Untitled";
    }

    return { url, title, isHome: false };
  }

  function findBookmarkByUrl(url) {
    if (!url) return null;
    return store.bookmarks.find((b) => b.url === url) || null;
  }

  function getFolder(id) {
    return store.folders.find((f) => f.id === id) || null;
  }

  function getChildFolders(parentId) {
    return store.folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function getBookmarksInFolder(folderId) {
    return store.bookmarks
      .filter((b) => b.folderId === folderId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function folderOptionsHtml(selectedId) {
    const roots = store.folders
      .filter((f) => f.parentId === null)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    function walk(folder, depth) {
      const pad = "&nbsp;".repeat(depth * 2);
      const selected = folder.id === selectedId ? " selected" : "";
      let html = `<option value="${folder.id}"${selected}>${pad}${escapeAttr(folder.name)}</option>`;
      getChildFolders(folder.id).forEach((child) => {
        html += walk(child, depth + 1);
      });
      return html;
    }

    return roots.map((f) => walk(f, 0)).join("");
  }

  function escapeAttr(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateStarButton() {
    const star = document.getElementById("bookmarkStarBtn");
    if (!star) return;

    const page = getCurrentPage();
    const existing = findBookmarkByUrl(page.url);
    const canBookmark = page.url && !page.isHome && page.url !== "about:blank";

    star.disabled = !canBookmark;
    star.classList.toggle("bookmarked", !!existing);
    star.title = existing ? "Edit bookmark" : "Bookmark this page";
    star.setAttribute("aria-label", star.title);
    star.textContent = existing ? "★" : "☆";
  }

  function renderBookmarksBar() {
    const bar = document.getElementById("bookmarksBar");
    const itemsEl = document.getElementById("bookmarksBarItems");
    if (!bar || !itemsEl) return;

    const barBookmarks = getBookmarksInFolder(BOOKMARKS_BAR_ID);
    const barFolders = getChildFolders(BOOKMARKS_BAR_ID);

    const showBar = window.Settings
      ? Settings.shouldShowBookmarksBar()
      : true;

    if (!showBar) {
      bar.style.display = "none";
      document.body.classList.remove("has-bookmarks-bar");
      itemsEl.innerHTML = "";
      return;
    }

    bar.style.display = "flex";
    itemsEl.innerHTML = "";

    barFolders.forEach((folder) => {
      const wrap = document.createElement("div");
      wrap.className = "bm-bar-folder-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bm-bar-item bm-bar-folder";
      btn.textContent = "📁 " + folder.name;
      btn.title = folder.name;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleBarFolderMenu(folder.id, wrap);
      });

      wrap.appendChild(btn);
      itemsEl.appendChild(wrap);
    });

    barBookmarks.forEach((bm) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bm-bar-item";
      btn.textContent = bm.title || bm.url;
      btn.title = bm.url;
      btn.addEventListener("click", () => openBookmarkUrl(bm.url));
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showBarContextMenu(e.clientX, e.clientY, bm);
      });
      itemsEl.appendChild(btn);
    });

    if (!barFolders.length && !barBookmarks.length) {
      const empty = document.createElement("span");
      empty.className = "bm-bar-empty";
      empty.textContent = "Drag or add bookmarks to the Bookmarks bar";
      itemsEl.appendChild(empty);
    }

    document.body.classList.add("has-bookmarks-bar");
  }

  function closeBarFolderMenus() {
    openFolderMenuId = null;
    document.querySelectorAll(".bm-bar-dropdown").forEach((el) => el.remove());
  }

  function toggleBarFolderMenu(folderId, wrap) {
    if (openFolderMenuId === folderId) {
      closeBarFolderMenus();
      return;
    }

    closeBarFolderMenus();
    openFolderMenuId = folderId;

    const menu = document.createElement("div");
    menu.className = "bm-bar-dropdown";

    const children = getChildFolders(folderId);
    const items = getBookmarksInFolder(folderId);

    if (!children.length && !items.length) {
      const empty = document.createElement("div");
      empty.className = "bm-bar-dropdown-empty";
      empty.textContent = "Empty folder";
      menu.appendChild(empty);
    }

    children.forEach((child) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "bm-bar-dropdown-item";
      row.textContent = "📁 " + child.name;
      row.addEventListener("click", () => {
        closeBarFolderMenus();
        selectedFolderId = child.id;
        openManager();
      });
      menu.appendChild(row);
    });

    items.forEach((bm) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "bm-bar-dropdown-item";
      row.textContent = bm.title || bm.url;
      row.title = bm.url;
      row.addEventListener("click", () => {
        closeBarFolderMenus();
        openBookmarkUrl(bm.url);
      });
      menu.appendChild(row);
    });

    wrap.appendChild(menu);
  }

  function showBarContextMenu(x, y, bookmark) {
    closeContextMenu();
    const menu = document.createElement("div");
    menu.id = "bmContextMenu";
    menu.className = "bm-context-menu";
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const actions = [
      { label: "Open", run: () => openBookmarkUrl(bookmark.url) },
      { label: "Edit…", run: () => openEditBookmarkDialog(bookmark) },
      { label: "Delete", run: () => deleteBookmark(bookmark.id) }
    ];

    actions.forEach((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        closeContextMenu();
        action.run();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
  }

  function closeContextMenu() {
    const menu = document.getElementById("bmContextMenu");
    if (menu) menu.remove();
  }

  function openBookmarkUrl(url) {
    if (!url) return;
    const urlInput = document.getElementById("url");
    if (urlInput) urlInput.value = url;
    if (typeof loadSite === "function") {
      loadSite();
    }
  }

  function renderManagerTree() {
    const tree = document.getElementById("bmFolderTree");
    if (!tree) return;

    tree.innerHTML = "";

    const roots = store.folders
      .filter((f) => f.parentId === null)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    function appendFolder(folder, depth) {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "bm-folder-row" + (folder.id === selectedFolderId ? " active" : "");
      row.style.paddingLeft = 12 + depth * 14 + "px";
      row.innerHTML = `<span class="bm-folder-icon">📁</span><span class="bm-folder-name">${escapeAttr(folder.name)}</span>`;
      row.addEventListener("click", () => {
        selectedFolderId = folder.id;
        searchQuery = "";
        const searchInput = document.getElementById("bmSearchInput");
        if (searchInput) searchInput.value = "";
        renderManager();
      });
      tree.appendChild(row);

      getChildFolders(folder.id).forEach((child) => appendFolder(child, depth + 1));
    }

    roots.forEach((folder) => appendFolder(folder, 0));
  }

  function renderManagerList() {
    const list = document.getElementById("bmList");
    const heading = document.getElementById("bmListHeading");
    if (!list) return;

    const query = searchQuery.trim().toLowerCase();
    let items = [];

    if (query) {
      items = store.bookmarks.filter((b) => {
        return (
          (b.title || "").toLowerCase().includes(query) ||
          (b.url || "").toLowerCase().includes(query)
        );
      });
      if (heading) heading.textContent = `Search results (${items.length})`;
    } else {
      items = getBookmarksInFolder(selectedFolderId);
      const folder = getFolder(selectedFolderId);
      if (heading) heading.textContent = folder ? folder.name : "Bookmarks";
    }

    list.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "bm-list-empty";
      empty.textContent = query ? "No bookmarks match your search." : "No bookmarks in this folder.";
      list.appendChild(empty);
      return;
    }

    items.forEach((bm) => {
      const row = document.createElement("div");
      row.className = "bm-list-row";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "bm-list-main";
      main.innerHTML = `<div class="bm-list-title">${escapeAttr(bm.title || bm.url)}</div><div class="bm-list-url">${escapeAttr(bm.url)}</div>`;
      main.addEventListener("click", () => openBookmarkUrl(bm.url));

      const actions = document.createElement("div");
      actions.className = "bm-list-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openEditBookmarkDialog(bm));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteBookmark(bm.id));

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(main);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function renderManager() {
    renderManagerTree();
    renderManagerList();
    updateManagerFolderActions();
  }

  function updateManagerFolderActions() {
    const renameBtn = document.getElementById("bmRenameFolderBtn");
    const deleteBtn = document.getElementById("bmDeleteFolderBtn");
    const folder = getFolder(selectedFolderId);
    const isSystem = folder && (folder.isSystem || folder.id === BOOKMARKS_BAR_ID || folder.id === OTHER_BOOKMARKS_ID);

    if (renameBtn) renameBtn.disabled = !folder || isSystem;
    if (deleteBtn) deleteBtn.disabled = !folder || isSystem;
  }

  function renderAll() {
    updateStarButton();
    renderBookmarksBar();
    const manager = document.getElementById("bookmarkManager");
    if (manager && manager.classList.contains("open")) {
      renderManager();
    }
  }

  async function toggleOrEditCurrent() {
    const page = getCurrentPage();
    if (!page.url || page.isHome || page.url === "about:blank") {
      alert("Open a page before adding a bookmark.");
      return;
    }

    const existing = findBookmarkByUrl(page.url);
    if (existing) {
      openEditBookmarkDialog(existing);
      return;
    }

    openAddBookmarkDialog(page.title, page.url, BOOKMARKS_BAR_ID);
  }

  function openAddBookmarkDialog(title, url, folderId) {
    openBookmarkFormDialog({
      mode: "add",
      title: title || "",
      url: url || "",
      folderId: folderId || BOOKMARKS_BAR_ID
    });
  }

  function openEditBookmarkDialog(bookmark) {
    openBookmarkFormDialog({
      mode: "edit",
      id: bookmark.id,
      title: bookmark.title || "",
      url: bookmark.url || "",
      folderId: bookmark.folderId || OTHER_BOOKMARKS_ID
    });
  }

  function openBookmarkFormDialog(state) {
    const backdrop = document.getElementById("bmFormBackdrop");
    const titleEl = document.getElementById("bmFormTitle");
    const nameInput = document.getElementById("bmFormName");
    const urlInput = document.getElementById("bmFormUrl");
    const folderSelect = document.getElementById("bmFormFolder");
    const deleteBtn = document.getElementById("bmFormDeleteBtn");

    if (!backdrop || !nameInput || !urlInput || !folderSelect) return;

    titleEl.textContent = state.mode === "edit" ? "Edit bookmark" : "Add bookmark";
    nameInput.value = state.title || "";
    urlInput.value = state.url || "";
    folderSelect.innerHTML = folderOptionsHtml(state.folderId);
    backdrop.dataset.mode = state.mode;
    backdrop.dataset.id = state.id || "";
    if (deleteBtn) {
      deleteBtn.style.display = state.mode === "edit" ? "inline-flex" : "none";
    }

    backdrop.classList.add("open");
    setTimeout(() => nameInput.focus(), 50);
  }

  function closeBookmarkFormDialog() {
    const backdrop = document.getElementById("bmFormBackdrop");
    if (backdrop) backdrop.classList.remove("open");
  }

  async function saveBookmarkForm() {
    const bridge = ensureApi();
    if (!bridge) return;

    const backdrop = document.getElementById("bmFormBackdrop");
    const nameInput = document.getElementById("bmFormName");
    const urlInput = document.getElementById("bmFormUrl");
    const folderSelect = document.getElementById("bmFormFolder");

    const title = (nameInput.value || "").trim();
    const url = (urlInput.value || "").trim();
    const folderId = folderSelect.value;

    if (!url) {
      alert("URL is required.");
      return;
    }

    let result;
    if (backdrop.dataset.mode === "edit") {
      result = await bridge.bookmarksUpdate({
        id: backdrop.dataset.id,
        title: title || url,
        url,
        folderId
      });
    } else {
      result = await bridge.bookmarksAdd({
        title: title || url,
        url,
        folderId
      });
    }

    if (!result || !result.success) {
      alert((result && result.error) || "Could not save bookmark.");
      return;
    }

    applyStore(result.data);
    closeBookmarkFormDialog();
  }

  async function deleteBookmarkFromForm() {
    const backdrop = document.getElementById("bmFormBackdrop");
    const id = backdrop && backdrop.dataset.id;
    if (!id) return;
    await deleteBookmark(id);
    closeBookmarkFormDialog();
  }

  async function deleteBookmark(id) {
    const bridge = ensureApi();
    if (!bridge) return;

    if (!confirm("Delete this bookmark?")) return;

    const result = await bridge.bookmarksDelete(id);
    if (!result || !result.success) {
      alert((result && result.error) || "Could not delete bookmark.");
      return;
    }

    applyStore(result.data);
  }

  async function createFolder() {
    const bridge = ensureApi();
    if (!bridge) return;

    const name = prompt("Folder name:", "New folder");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alert("Folder name is required.");
      return;
    }

    const parentId = selectedFolderId || OTHER_BOOKMARKS_ID;
    const result = await bridge.bookmarksAddFolder({ name: trimmed, parentId });
    if (!result || !result.success) {
      alert((result && result.error) || "Could not create folder.");
      return;
    }

    selectedFolderId = result.folder.id;
    applyStore(result.data);
  }

  async function renameSelectedFolder() {
    const bridge = ensureApi();
    if (!bridge) return;

    const folder = getFolder(selectedFolderId);
    if (!folder || folder.isSystem) return;

    const name = prompt("Rename folder:", folder.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alert("Folder name is required.");
      return;
    }

    const result = await bridge.bookmarksUpdateFolder({ id: folder.id, name: trimmed });
    if (!result || !result.success) {
      alert((result && result.error) || "Could not rename folder.");
      return;
    }

    applyStore(result.data);
  }

  async function deleteSelectedFolder() {
    const bridge = ensureApi();
    if (!bridge) return;

    const folder = getFolder(selectedFolderId);
    if (!folder || folder.isSystem) return;

    if (!confirm(`Delete folder "${folder.name}" and all bookmarks inside it?`)) {
      return;
    }

    const result = await bridge.bookmarksDeleteFolder(folder.id);
    if (!result || !result.success) {
      alert((result && result.error) || "Could not delete folder.");
      return;
    }

    selectedFolderId = BOOKMARKS_BAR_ID;
    applyStore(result.data);
  }

  async function importHtml() {
    const bridge = ensureApi();
    if (!bridge) return;

    const result = await bridge.bookmarksImportHtml();
    if (!result) return;
    if (result.canceled) return;

    if (!result.success) {
      alert(result.error || "Import failed.");
      return;
    }

    applyStore(result.data);
    alert(`Imported ${result.importedCount} bookmark(s).`);
  }

  async function exportHtml() {
    const bridge = ensureApi();
    if (!bridge) return;

    const result = await bridge.bookmarksExportHtml();
    if (!result) return;
    if (result.canceled) return;

    if (!result.success) {
      alert(result.error || "Export failed.");
      return;
    }

    alert("Bookmarks exported successfully.");
  }

  function openManager() {
    const manager = document.getElementById("bookmarkManager");
    if (!manager) return;
    manager.classList.add("open");
    renderManager();
    const searchInput = document.getElementById("bmSearchInput");
    if (searchInput) searchInput.focus();
  }

  function closeManager() {
    const manager = document.getElementById("bookmarkManager");
    if (manager) manager.classList.remove("open");
  }

  function onSearchInput(value) {
    searchQuery = value || "";
    renderManagerList();
  }

  function onPageChanged() {
    updateStarButton();
  }

  async function init() {
    await refreshStore();
    renderAll();

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".bm-bar-folder-wrap")) {
        closeBarFolderMenus();
      }
      if (!e.target.closest("#bmContextMenu")) {
        closeContextMenu();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeBookmarkFormDialog();
        closeManager();
        closeBarFolderMenus();
        closeContextMenu();
      }
    });
  }

  return {
    init,
    toggleOrEditCurrent,
    openManager,
    closeManager,
    createFolder,
    renameSelectedFolder,
    deleteSelectedFolder,
    importHtml,
    exportHtml,
    onSearchInput,
    onPageChanged,
    saveBookmarkForm,
    closeBookmarkFormDialog,
    deleteBookmarkFromForm,
    refreshBar: renderBookmarksBar
  };
})();

window.Bookmarks = Bookmarks;
