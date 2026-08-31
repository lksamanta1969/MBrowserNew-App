const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    classifyMessage,
    normalizeCategory,
    normalizeSmartTags,
    detectHasAttachments,
    detectImportant,
    CORE_CATEGORIES,
    SMART_TAGS,
    SMART_VIEWS,
    isValidSmartView,
    recordMatchesSmartView
} = require("./MailClassifier");
const {
    normalizeLevels,
    findLevel,
    getLevelsWithCounts,
    createLevelId
} = require("./MailLevels");
const { DEFAULT_SYNC_CATEGORIES, normalizeSyncCategories } = require("./GmailSyncSettings");

const DB_VERSION = 6;

function defaultDb() {
    return { version: DB_VERSION, levels: [], sent: [], drafts: [], inbox: [], syncCategories: { ...DEFAULT_SYNC_CATEGORIES } };
}

function createMessageId() {
    if (crypto.randomUUID) return `msg_${crypto.randomUUID()}`;
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return Date.now();
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function normalizeRecord(raw, defaultMailbox) {
    const record = { ...(raw || {}) };
    const now = Date.now();

    if (!record.id) record.id = createMessageId();
    if (!record.mailbox) {
        record.mailbox = record.trashedAt ? "trash" : defaultMailbox;
    }
    if (record.trashedAt === undefined) record.trashedAt = null;
    if (record.deletedAt === undefined) record.deletedAt = null;
    if (record.previousMailbox === undefined) record.previousMailbox = null;
    if (!record.createdAt) record.createdAt = parseTimestamp(record.date);
    if (!record.updatedAt) record.updatedAt = now;

    if (!record.category) record.category = "primary";
    else record.category = normalizeCategory(record.category);
    if (!Array.isArray(record.smartTags)) record.smartTags = [];
    else record.smartTags = normalizeSmartTags(record.smartTags);
    if (record.isRead === undefined) record.isRead = true;
    if (record.starred === undefined) record.starred = false;
    if (record.important === undefined) record.important = false;
    if (record.hasAttachments === undefined) record.hasAttachments = false;
    if (record.archivedAt === undefined) record.archivedAt = null;
    if (record.messageId === undefined) record.messageId = null;
    if (record.inReplyTo === undefined) record.inReplyTo = null;
    if (record.references === undefined) record.references = [];
    if (record.replyTo === undefined) record.replyTo = null;
    if (record.levelId === undefined) record.levelId = null;

    if (record.trashedAt && record.mailbox !== "trash") {
        record.mailbox = "trash";
    }

    return record;
}

function normalizeArray(records, defaultMailbox) {
    if (!Array.isArray(records)) return [];
    return records.map((item) => normalizeRecord(item, defaultMailbox));
}

function needsMigration(db) {
    if (!db || typeof db !== "object") return true;
    if (db.version !== DB_VERSION) return true;
    if (!Array.isArray(db.levels)) return true;
    if (!db.syncCategories || typeof db.syncCategories !== "object") return true;

    const arrays = [db.sent, db.drafts, db.inbox];
    for (let i = 0; i < arrays.length; i++) {
        const list = arrays[i];
        if (!Array.isArray(list)) return true;
        for (let j = 0; j < list.length; j++) {
            const item = list[j];
            if (!item || !item.id) return true;
            if (item.category === undefined || item.smartTags === undefined) return true;
            if (item.isRead === undefined || item.starred === undefined) return true;
            if (item.important === undefined || item.hasAttachments === undefined) return true;
            if (item.archivedAt === undefined) return true;
            if (item.levelId === undefined) return true;
        }
    }
    return false;
}

function applyInboxClassification(record, options = {}) {
    if (!record) return record;
    const classified = classifyMessage(record);
    if (options.reclassifyCategory || !record.category || (record.category === "primary" && !options.keepCategory)) {
        record.category = classified.category;
    } else {
        record.category = normalizeCategory(record.category);
    }
    record.smartTags = classified.smartTags;
    record.hasAttachments = record.hasAttachments || classified.hasAttachments;
    if (!record.important) record.important = detectImportant(record);
    return record;
}

function migrateDb(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const migrated = {
        version: DB_VERSION,
        levels: normalizeLevels(base.levels),
        sent: normalizeArray(base.sent, "sent"),
        drafts: normalizeArray(base.drafts, "drafts"),
        inbox: normalizeArray(base.inbox, "inbox"),
        syncCategories: normalizeSyncCategories(base.syncCategories)
    };

    const isFreshMigration = !base.version || base.version < DB_VERSION;
    migrated.inbox.forEach((record) => {
        if (record.levelId === undefined) record.levelId = null;
        if (record.isRead === undefined) record.isRead = true;
        if (record.starred === undefined) record.starred = false;
        if (record.important === undefined) record.important = false;
        if (record.hasAttachments === undefined) record.hasAttachments = false;
        if (record.archivedAt === undefined) record.archivedAt = null;
        record.smartTags = normalizeSmartTags(record.smartTags);

        if (isFreshMigration && record.mailbox === "inbox" && isActive(record)) {
            applyInboxClassification(record, { reclassifyCategory: record.category === "primary" });
        }
    });

    return migrated;
}

function isActive(record) {
    return !!(record && !record.trashedAt && !record.deletedAt);
}

function isInTrash(record) {
    return !!(record && record.trashedAt && !record.deletedAt);
}

function isPermanentlyDeleted(record) {
    return !!(record && record.deletedAt);
}

function countRecords(db) {
    return {
        sent: Array.isArray(db.sent) ? db.sent.length : 0,
        drafts: Array.isArray(db.drafts) ? db.drafts.length : 0,
        inbox: Array.isArray(db.inbox) ? db.inbox.length : 0
    };
}

function createMailStore(dbPath) {
    let cache = null;
    let backupCreated = false;

    function createBackup() {
        if (backupCreated || !fs.existsSync(dbPath)) return null;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${dbPath}.bak.${stamp}`;
        fs.copyFileSync(dbPath, backupPath);
        backupCreated = true;
        console.log("[MMAIL] Backup created:", backupPath);
        return backupPath;
    }

    function readRawFile() {
        if (!fs.existsSync(dbPath)) return defaultDb();
        try {
            const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
            return parsed && typeof parsed === "object" ? parsed : defaultDb();
        } catch (error) {
            console.error("[MMAIL] Failed to read maildb:", error);
            return defaultDb();
        }
    }

    function load() {
        if (cache) return cache;

        const raw = readRawFile();
        const before = countRecords(raw);

        if (fs.existsSync(dbPath) && needsMigration(raw)) {
            createBackup();
        }

        cache = migrateDb(raw);
        const after = countRecords(cache);

        if (needsMigration(raw)) {
            console.log("[MMAIL] Migration counts before:", before);
            console.log("[MMAIL] Migration counts after:", after);
            const categoryCounts = getInboxCategoryCounts(cache);
            console.log("[MMAIL] Inbox category counts:", categoryCounts);
            persist(cache, { skipBackup: true });
        }

        return cache;
    }

    function persist(data, options = {}) {
        const payload = migrateDb(data);
        if (!options.skipBackup && fs.existsSync(dbPath) && !backupCreated) {
            createBackup();
        }
        fs.writeFileSync(dbPath, JSON.stringify(payload, null, 2), "utf8");
        cache = payload;
        return payload;
    }

    function save(data) {
        return persist(data);
    }

    function reload() {
        cache = null;
        return load();
    }

    function getActiveList(db, arrayName, mailbox) {
        const list = Array.isArray(db[arrayName]) ? db[arrayName] : [];
        return list.filter((item) => isActive(item) && item.mailbox === mailbox);
    }

    function getActiveDrafts(db) {
        return getActiveList(db, "drafts", "drafts");
    }

    function getActiveInbox(db, filters = {}) {
        let list = getActiveList(db, "inbox", "inbox");
        const category = filters.category ? normalizeCategory(filters.category) : null;
        const smartTag = filters.smartTag ? String(filters.smartTag).toLowerCase() : null;
        const smartView = filters.smartView ? String(filters.smartView).toLowerCase() : null;
        const levelId = filters.levelId ? String(filters.levelId) : null;
        const showArchived = smartView === "archived";

        if (levelId) {
            list = list.filter((item) => item.levelId === levelId);
        } else {
            list = list.filter((item) => !item.levelId);
        }

        if (showArchived) {
            list = list.filter((item) => !!item.archivedAt);
        } else {
            list = list.filter((item) => !item.archivedAt);
        }

        if (category) {
            list = list.filter((item) => normalizeCategory(item.category) === category);
        }
        if (smartTag) {
            const tag = smartTag === "finance" ? "bills" : smartTag;
            list = list.filter((item) => {
                if (!Array.isArray(item.smartTags)) return false;
                return item.smartTags.includes(tag) || (tag === "bills" && item.smartTags.includes("finance"));
            });
        }
        if (smartView && smartView !== "archived" && isValidSmartView(smartView)) {
            list = list.filter((item) => recordMatchesSmartView(item, smartView));
        }
        return list;
    }

    function getArchivedCount(db) {
        return getActiveList(db, "inbox", "inbox").filter((item) => !!item.archivedAt).length;
    }

    function getLevels(db) {
        return getLevelsWithCounts(db, isActive);
    }

    function getInboxCategoryCounts(db) {
        const counts = {};
        CORE_CATEGORIES.forEach((cat) => {
            counts[cat] = 0;
        });
        getActiveList(db, "inbox", "inbox").forEach((item) => {
            if (item.archivedAt || item.levelId) return;
            const cat = normalizeCategory(item.category);
            counts[cat] = (counts[cat] || 0) + 1;
        });
        return counts;
    }

    function getSmartViewCounts(db) {
        const counts = {};
        SMART_VIEWS.forEach((view) => {
            counts[view] = 0;
        });
        getActiveList(db, "inbox", "inbox").forEach((item) => {
            if (item.archivedAt || item.levelId) return;
            SMART_VIEWS.forEach((view) => {
                if (recordMatchesSmartView(item, view)) counts[view] = (counts[view] || 0) + 1;
            });
        });
        return counts;
    }

    function getActiveSent(db) {
        return getActiveList(db, "sent", "sent");
    }

    function getTrashItems(db) {
        const all = []
            .concat(Array.isArray(db.inbox) ? db.inbox : [])
            .concat(Array.isArray(db.sent) ? db.sent : [])
            .concat(Array.isArray(db.drafts) ? db.drafts : []);
        return all.filter((item) => isInTrash(item));
    }

    function findRecordLocation(db, id) {
        const arrays = ["inbox", "sent", "drafts"];
        for (let i = 0; i < arrays.length; i++) {
            const name = arrays[i];
            const list = Array.isArray(db[name]) ? db[name] : [];
            const index = list.findIndex((item) => item && item.id === id);
            if (index >= 0) return { arrayName: name, index, record: list[index] };
        }
        return null;
    }

    function prepareNewRecord(payload, mailbox) {
        const now = Date.now();
        const record = normalizeRecord(
            {
                ...payload,
                mailbox,
                trashedAt: null,
                deletedAt: null,
                previousMailbox: null,
                isRead: mailbox === "inbox" ? false : true,
                starred: false,
                important: false,
                hasAttachments: false,
                createdAt: now,
                updatedAt: now
            },
            mailbox
        );
        if (mailbox === "inbox") {
            applyInboxClassification(record, {
                reclassifyCategory: !record.syncCategory,
                keepCategory: !!record.syncCategory
            });
        }
        return record;
    }

    return {
        dbPath,
        load,
        save,
        reload,
        createBackup,
        countRecords,
        getActiveDrafts,
        getActiveInbox,
        getInboxCategoryCounts,
        getSmartViewCounts,
        getArchivedCount,
        getLevels,
        getActiveSent,
        getTrashItems,
        findRecordLocation,
        prepareNewRecord,
        isActive,
        isInTrash,
        isPermanentlyDeleted,
        normalizeRecord,
        createMessageId
    };
}

module.exports = { createMailStore, defaultDb, DB_VERSION };
