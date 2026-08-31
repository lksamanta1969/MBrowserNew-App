const fs = require("fs");
const crypto = require("crypto");

const DB_VERSION = 1;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 500000;

function defaultDb() {
    return { version: DB_VERSION, notes: [] };
}

function createNoteId() {
    if (crypto.randomUUID) return `note_${crypto.randomUUID()}`;
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return Date.now();
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function normalizeTitle(raw) {
    const title = String(raw || "").trim().slice(0, MAX_TITLE_LENGTH);
    return title || "Untitled";
}

function normalizeContent(raw) {
    if (raw === null || raw === undefined) return "";
    return String(raw).slice(0, MAX_CONTENT_LENGTH);
}

function titleFromContent(content) {
    const firstLine = String(content || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    if (!firstLine) return "Imported Note";
    return normalizeTitle(firstLine.slice(0, MAX_TITLE_LENGTH));
}

function normalizeNote(raw) {
    const now = Date.now();
    const note = { ...(raw || {}) };
    if (!note.id) note.id = createNoteId();
    note.title = normalizeTitle(note.title);
    note.content = normalizeContent(note.content);
    note.createdAt = parseTimestamp(note.createdAt);
    note.updatedAt = parseTimestamp(note.updatedAt || note.createdAt);
    if (note.updatedAt < note.createdAt) note.updatedAt = note.createdAt;
    return note;
}

function normalizeDb(raw) {
    const db = raw && typeof raw === "object" ? { ...raw } : defaultDb();
    if (!Array.isArray(db.notes)) db.notes = [];
    db.version = DB_VERSION;
    db.notes = db.notes.map((item) => normalizeNote(item));
    db.notes.sort((a, b) => b.updatedAt - a.updatedAt);
    return db;
}

function createMNotesStore(dbPath) {
    let cache = null;
    let backupCreated = false;

    function createBackup() {
        if (backupCreated || !fs.existsSync(dbPath)) return null;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${dbPath}.bak.${stamp}`;
        fs.copyFileSync(dbPath, backupPath);
        backupCreated = true;
        console.log("[MNOTES] Backup created:", backupPath);
        return backupPath;
    }

    function readRawFile() {
        if (!fs.existsSync(dbPath)) return defaultDb();
        try {
            const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
            return parsed && typeof parsed === "object" ? parsed : defaultDb();
        } catch (error) {
            console.error("[MNOTES] Failed to read mnotes.json:", error);
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

    function listNotes() {
        const db = load();
        return db.notes.map((note) => ({
            id: note.id,
            title: note.title,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt
        }));
    }

    function getNote(id) {
        const db = load();
        const note = db.notes.find((item) => item.id === id);
        return note ? { ...note } : null;
    }

    function createNote({ title, content } = {}) {
        const db = load();
        const now = Date.now();
        const note = normalizeNote({
            id: createNoteId(),
            title: normalizeTitle(title),
            content: normalizeContent(content),
            createdAt: now,
            updatedAt: now
        });
        db.notes.unshift(note);
        persist(db);
        return { ...note };
    }

    function updateNote(id, { title, content } = {}) {
        const db = load();
        const index = db.notes.findIndex((item) => item.id === id);
        if (index === -1) return null;

        const existing = db.notes[index];
        const updated = normalizeNote({
            ...existing,
            title: title !== undefined ? normalizeTitle(title) : existing.title,
            content: content !== undefined ? normalizeContent(content) : existing.content,
            updatedAt: Date.now()
        });
        db.notes[index] = updated;
        persist(db);
        return { ...updated };
    }

    function importLegacyContent(content) {
        const db = load();
        if (db.notes.length > 0) {
            return { success: false, error: "Notes already exist. Legacy import skipped." };
        }

        const normalizedContent = normalizeContent(content);
        if (!normalizedContent.trim()) {
            return { success: false, error: "Legacy note content is empty." };
        }

        const note = createNote({
            title: titleFromContent(normalizedContent),
            content: normalizedContent
        });

        return { success: true, note };
    }

    return {
        load,
        reload,
        listNotes,
        getNote,
        createNote,
        updateNote,
        importLegacyContent,
        MAX_TITLE_LENGTH,
        MAX_CONTENT_LENGTH
    };
}

module.exports = {
    createMNotesStore,
    normalizeTitle,
    normalizeContent,
    titleFromContent
};
