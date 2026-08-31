const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_VERSION = 1;
const MAX_QUERY_LENGTH = 300;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_PATH_LENGTH = 4096;
const MAX_SEARCH_HISTORY = 100;
const MAX_RECENTLY_OPENED = 50;
const MAX_SAVED_VIDEOS = 200;
const MAX_LIBRARY_ITEMS = 500;

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".ogv", ".mov", ".mkv", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus"]);

function defaultDb() {
    return {
        version: DB_VERSION,
        searchHistory: [],
        recentlyOpened: [],
        savedVideos: [],
        localLibrary: []
    };
}

function createId(prefix) {
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return Date.now();
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function normalizeQuery(raw) {
    return String(raw || "").trim().slice(0, MAX_QUERY_LENGTH);
}

function normalizeTitle(raw, fallback) {
    const title = String(raw || "").trim().slice(0, MAX_TITLE_LENGTH);
    return title || fallback || "Untitled";
}

function normalizeUrl(raw) {
    const url = String(raw || "").trim().slice(0, MAX_URL_LENGTH);
    if (!url) return "";
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
        return parsed.toString();
    } catch (error) {
        return "";
    }
}

function normalizePath(raw) {
    const filePath = String(raw || "").trim().slice(0, MAX_PATH_LENGTH);
    if (!filePath) return "";
    return path.normalize(filePath);
}

function detectMediaType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
    if (AUDIO_EXTENSIONS.has(ext)) return "audio";
    return "unknown";
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".ogg": "video/ogg",
        ".ogv": "video/ogg",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".m4v": "video/x-m4v",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".oga": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".opus": "audio/opus"
    };
    return map[ext] || "application/octet-stream";
}

function extractYouTubeVideoId(raw) {
    const value = String(raw || "").trim();
    if (!value) return null;

    if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;

    try {
        const url = value.startsWith("http://") || value.startsWith("https://")
            ? new URL(value)
            : new URL(`https://${value}`);
        const host = url.hostname.replace(/^www\./, "");

        if (host === "youtu.be") {
            const id = url.pathname.split("/").filter(Boolean)[0];
            return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
        }

        if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
            if (url.pathname === "/watch") {
                const id = url.searchParams.get("v");
                return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
            }
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
                const id = parts[1];
                return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
            }
        }
    } catch (error) {
        return null;
    }

    return null;
}

function buildYouTubeWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildYouTubeEmbedUrl(videoId) {
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
}

function buildYouTubeSearchUrl(query) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function normalizeSearchEntry(raw) {
    const entry = { ...(raw || {}) };
    if (!entry.id) entry.id = createId("search");
    entry.query = normalizeQuery(entry.query);
    entry.searchedAt = parseTimestamp(entry.searchedAt);
    return entry;
}

function normalizeRecentEntry(raw) {
    const entry = { ...(raw || {}) };
    if (!entry.id) entry.id = createId("recent");
    entry.type = ["search", "youtube", "local"].includes(entry.type) ? entry.type : "search";
    entry.title = normalizeTitle(entry.title, entry.query || entry.url || "Opened item");
    entry.openedAt = parseTimestamp(entry.openedAt);
    if (entry.query !== undefined) entry.query = normalizeQuery(entry.query);
    if (entry.url !== undefined) entry.url = normalizeUrl(entry.url);
    if (entry.videoId !== undefined) entry.videoId = extractYouTubeVideoId(entry.videoId || entry.url) || null;
    if (entry.libraryId !== undefined) entry.libraryId = String(entry.libraryId || "").trim();
    return entry;
}

function normalizeSavedVideo(raw) {
    const item = { ...(raw || {}) };
    if (!item.id) item.id = createId("saved");
    item.url = normalizeUrl(item.url);
    item.videoId = extractYouTubeVideoId(item.url);
    item.title = normalizeTitle(item.title, item.videoId ? `YouTube Video ${item.videoId}` : "Saved Video");
    item.savedAt = parseTimestamp(item.savedAt);
    return item;
}

function normalizeLibraryItem(raw) {
    const item = { ...(raw || {}) };
    if (!item.id) item.id = createId("media");
    item.path = normalizePath(item.path);
    item.displayName = normalizeTitle(item.displayName, path.basename(item.path) || "Local Media");
    item.mediaType = ["video", "audio", "unknown"].includes(item.mediaType)
        ? item.mediaType
        : detectMediaType(item.path);
    item.addedAt = parseTimestamp(item.addedAt);
    return item;
}

function normalizeDb(raw) {
    const db = raw && typeof raw === "object" ? { ...raw } : defaultDb();
    db.version = DB_VERSION;
    db.searchHistory = Array.isArray(db.searchHistory)
        ? db.searchHistory.map((item) => normalizeSearchEntry(item)).filter((item) => item.query)
        : [];
    db.recentlyOpened = Array.isArray(db.recentlyOpened)
        ? db.recentlyOpened.map((item) => normalizeRecentEntry(item))
        : [];
    db.savedVideos = Array.isArray(db.savedVideos)
        ? db.savedVideos.map((item) => normalizeSavedVideo(item)).filter((item) => item.url && item.videoId)
        : [];
    db.localLibrary = Array.isArray(db.localLibrary)
        ? db.localLibrary.map((item) => normalizeLibraryItem(item)).filter((item) => item.path)
        : [];

    db.searchHistory.sort((a, b) => b.searchedAt - a.searchedAt);
    db.recentlyOpened.sort((a, b) => b.openedAt - a.openedAt);
    db.savedVideos.sort((a, b) => b.savedAt - a.savedAt);
    db.localLibrary.sort((a, b) => b.addedAt - a.addedAt);
    return db;
}

function recentMatchKey(entry) {
    if (entry.type === "search") return `search:${entry.query}`;
    if (entry.type === "youtube") return `youtube:${entry.videoId || entry.url}`;
    if (entry.type === "local") return `local:${entry.libraryId}`;
    return entry.id;
}

function withLibraryAvailability(item) {
    const available = !!(item.path && fs.existsSync(item.path));
    return {
        id: item.id,
        path: item.path,
        displayName: item.displayName,
        mediaType: item.mediaType,
        addedAt: item.addedAt,
        available
    };
}

function createMTubeStore(dbPath) {
    let cache = null;
    let backupCreated = false;

    function createBackup() {
        if (backupCreated || !fs.existsSync(dbPath)) return null;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${dbPath}.bak.${stamp}`;
        fs.copyFileSync(dbPath, backupPath);
        backupCreated = true;
        console.log("[MTUBE] Backup created:", backupPath);
        return backupPath;
    }

    function readRawFile() {
        if (!fs.existsSync(dbPath)) return defaultDb();
        try {
            const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
            return parsed && typeof parsed === "object" ? parsed : defaultDb();
        } catch (error) {
            console.error("[MTUBE] Failed to read mtubedb.json:", error);
            return defaultDb();
        }
    }

    function load() {
        if (cache) return cache;
        cache = normalizeDb(readRawFile());
        return cache;
    }

    function persist(data, options = {}) {
        const payload = normalizeDb(data);
        if (!options.skipBackup && fs.existsSync(dbPath) && !backupCreated) {
            createBackup();
        }
        fs.writeFileSync(dbPath, JSON.stringify(payload, null, 2), "utf8");
        cache = payload;
        return payload;
    }

    function reload() {
        cache = null;
        return load();
    }

    function getState() {
        const db = load();
        return {
            searchHistory: db.searchHistory.map((item) => ({ ...item })),
            recentlyOpened: db.recentlyOpened.map((item) => ({ ...item })),
            savedVideos: db.savedVideos.map((item) => ({ ...item })),
            localLibrary: db.localLibrary.map((item) => withLibraryAvailability(item))
        };
    }

    function addSearchHistory(query) {
        const normalizedQuery = normalizeQuery(query);
        if (!normalizedQuery) {
            return { success: false, error: "Search query is required." };
        }

        const db = load();
        db.searchHistory = db.searchHistory.filter((item) => item.query !== normalizedQuery);
        const entry = normalizeSearchEntry({ query: normalizedQuery, searchedAt: Date.now() });
        db.searchHistory.unshift(entry);
        db.searchHistory = db.searchHistory.slice(0, MAX_SEARCH_HISTORY);
        persist(db);
        return { success: true, entry };
    }

    function clearSearchHistory() {
        const db = load();
        db.searchHistory = [];
        persist(db);
        return { success: true };
    }

    function removeSearchHistory(id) {
        const db = load();
        const before = db.searchHistory.length;
        db.searchHistory = db.searchHistory.filter((item) => item.id !== id);
        if (db.searchHistory.length === before) {
            return { success: false, error: "Search history item not found." };
        }
        persist(db);
        return { success: true };
    }

    function addRecentlyOpened(payload = {}) {
        const db = load();
        const type = payload.type;
        let entry;

        if (type === "search") {
            const query = normalizeQuery(payload.query);
            if (!query) return { success: false, error: "Search query is required." };
            entry = normalizeRecentEntry({
                type: "search",
                query,
                title: normalizeTitle(payload.title, query),
                openedAt: Date.now()
            });
        } else if (type === "youtube") {
            const videoId = extractYouTubeVideoId(payload.url || payload.videoId);
            const url = normalizeUrl(payload.url || buildYouTubeWatchUrl(videoId));
            if (!videoId || !url) return { success: false, error: "Valid YouTube link is required." };
            entry = normalizeRecentEntry({
                type: "youtube",
                url,
                videoId,
                title: normalizeTitle(payload.title, `YouTube Video ${videoId}`),
                openedAt: Date.now()
            });
        } else if (type === "local") {
            const libraryId = String(payload.libraryId || "").trim();
            const libraryItem = db.localLibrary.find((item) => item.id === libraryId);
            if (!libraryItem) return { success: false, error: "Local library item not found." };
            entry = normalizeRecentEntry({
                type: "local",
                libraryId,
                title: normalizeTitle(payload.title, libraryItem.displayName),
                openedAt: Date.now()
            });
        } else {
            return { success: false, error: "Invalid recently opened type." };
        }

        const key = recentMatchKey(entry);
        db.recentlyOpened = db.recentlyOpened.filter((item) => recentMatchKey(item) !== key);
        db.recentlyOpened.unshift(entry);
        db.recentlyOpened = db.recentlyOpened.slice(0, MAX_RECENTLY_OPENED);
        persist(db);
        return { success: true, entry };
    }

    function addSavedVideo({ url, title } = {}) {
        const normalizedUrl = normalizeUrl(url);
        const videoId = extractYouTubeVideoId(normalizedUrl);
        if (!normalizedUrl || !videoId) {
            return { success: false, error: "Valid YouTube link is required." };
        }

        const db = load();
        const existing = db.savedVideos.find((item) => item.videoId === videoId);
        if (existing) {
            existing.title = normalizeTitle(title, existing.title);
            existing.url = normalizedUrl;
            existing.savedAt = Date.now();
            persist(db);
            return { success: true, item: { ...existing }, updated: true };
        }

        if (db.savedVideos.length >= MAX_SAVED_VIDEOS) {
            return { success: false, error: "Saved video limit reached." };
        }

        const item = normalizeSavedVideo({
            url: normalizedUrl,
            title,
            savedAt: Date.now()
        });
        db.savedVideos.unshift(item);
        persist(db);
        return { success: true, item: { ...item }, updated: false };
    }

    function removeSavedVideo(id) {
        const db = load();
        const before = db.savedVideos.length;
        db.savedVideos = db.savedVideos.filter((item) => item.id !== id);
        if (db.savedVideos.length === before) {
            return { success: false, error: "Saved video not found." };
        }
        persist(db);
        return { success: true };
    }

    function addLibraryItem({ path: filePath, displayName } = {}) {
        const normalizedPath = normalizePath(filePath);
        if (!normalizedPath) {
            return { success: false, error: "File path is required." };
        }
        if (!fs.existsSync(normalizedPath)) {
            return { success: false, error: "File not found at the selected path." };
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isFile()) {
            return { success: false, error: "Only regular files can be added to the library." };
        }

        const mediaType = detectMediaType(normalizedPath);
        if (mediaType === "unknown") {
            return { success: false, error: "Unsupported media type. Choose a video or audio file." };
        }

        const db = load();
        const existing = db.localLibrary.find((item) => item.path === normalizedPath);
        if (existing) {
            existing.displayName = normalizeTitle(displayName, existing.displayName);
            existing.mediaType = mediaType;
            existing.addedAt = Date.now();
            persist(db);
            return { success: true, item: withLibraryAvailability(existing), updated: true };
        }

        if (db.localLibrary.length >= MAX_LIBRARY_ITEMS) {
            return { success: false, error: "Local library limit reached." };
        }

        const item = normalizeLibraryItem({
            path: normalizedPath,
            displayName: displayName || path.basename(normalizedPath),
            mediaType,
            addedAt: Date.now()
        });
        db.localLibrary.unshift(item);
        persist(db);
        return { success: true, item: withLibraryAvailability(item), updated: false };
    }

    function removeLibraryItem(id) {
        const db = load();
        const before = db.localLibrary.length;
        db.localLibrary = db.localLibrary.filter((item) => item.id !== id);
        if (db.localLibrary.length === before) {
            return { success: false, error: "Library item not found." };
        }
        persist(db);
        return { success: true };
    }

    function getLibraryItem(id) {
        const db = load();
        const item = db.localLibrary.find((entry) => entry.id === id);
        return item ? withLibraryAvailability(item) : null;
    }

    function getLibraryStreamInfo(id) {
        const item = getLibraryItem(id);
        if (!item) return { success: false, error: "Library item not found." };
        if (!item.available) {
            return {
                success: false,
                error: "This file is unavailable. It may have been moved, renamed, or deleted.",
                item
            };
        }
        return {
            success: true,
            item,
            mimeType: getMimeType(item.path),
            size: fs.statSync(item.path).size
        };
    }

    return {
        load,
        reload,
        getState,
        addSearchHistory,
        clearSearchHistory,
        removeSearchHistory,
        addRecentlyOpened,
        addSavedVideo,
        removeSavedVideo,
        addLibraryItem,
        removeLibraryItem,
        getLibraryItem,
        getLibraryStreamInfo,
        extractYouTubeVideoId,
        buildYouTubeEmbedUrl,
        buildYouTubeSearchUrl,
        buildYouTubeWatchUrl,
        getMimeType
    };
}

module.exports = {
    createMTubeStore,
    extractYouTubeVideoId,
    buildYouTubeEmbedUrl,
    buildYouTubeSearchUrl,
    buildYouTubeWatchUrl,
    getMimeType,
    detectMediaType
};
