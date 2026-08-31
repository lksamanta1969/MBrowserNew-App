const { isValidCategory, normalizeCategory } = require("./MailClassifier");
const { findLevel, normalizeLevel, createLevelId } = require("./MailLevels");

function createMailActions(store) {
    function touch(record) {
        record.updatedAt = Date.now();
        return record;
    }

    function trashRecord(record, previousMailbox) {
        const sourceMailbox = previousMailbox || record.mailbox || "drafts";
        record.previousMailbox = sourceMailbox;
        record.mailbox = "trash";
        record.trashedAt = Date.now();
        record.deletedAt = null;
        return touch(record);
    }

    function restoreRecord(record) {
        record.mailbox = record.previousMailbox || "drafts";
        record.previousMailbox = null;
        record.trashedAt = null;
        record.deletedAt = null;
        return touch(record);
    }

    function deletePermanently(record) {
        record.deletedAt = Date.now();
        return touch(record);
    }

    function trashDraftByIndex(index) {
        const db = store.load();
        const activeDrafts = store.getActiveDrafts(db);
        const target = activeDrafts[index];

        if (!target || !target.id) {
            return { success: false, error: "Draft not found." };
        }

        const location = store.findRecordLocation(db, target.id);
        if (!location || !location.record) {
            return { success: false, error: "Draft not found." };
        }

        trashRecord(location.record, "drafts");
        store.save(db);
        return { success: true, id: location.record.id };
    }

    function trashByIds(ids) {
        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isActive(location.record)) return;
            trashRecord(location.record, location.record.mailbox);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No active messages found to trash." };
        }

        store.save(db);
        return { success: true, ids: changed };
    }

    function restoreByIds(ids) {
        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isInTrash(location.record)) return;
            restoreRecord(location.record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No trash messages found to restore." };
        }

        store.save(db);
        return { success: true, ids: changed };
    }

    function deletePermanentlyByIds(ids) {
        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isInTrash(location.record)) return;
            deletePermanently(location.record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No trash messages found to delete permanently." };
        }

        store.save(db);
        return { success: true, ids: changed };
    }

    function emptyTrash() {
        const db = store.load();
        const trashed = store.getTrashItems(db);
        if (!trashed.length) {
            return { success: true, deletedCount: 0 };
        }

        trashed.forEach((record) => deletePermanently(record));
        store.save(db);
        return { success: true, deletedCount: trashed.length };
    }

    const VALID_MOVE_MAILBOXES = new Set(["inbox", "sent", "trash"]);

    function moveByIds(ids, targetMailbox) {
        const mailbox = String(targetMailbox || "").trim();
        if (!VALID_MOVE_MAILBOXES.has(mailbox)) {
            return { success: false, error: "Invalid move destination." };
        }

        if (mailbox === "trash") {
            return trashByIds(ids);
        }

        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isActive(location.record)) return;

            const record = location.record;
            const sourceArray = location.arrayName;
            if (sourceArray === mailbox && record.mailbox === mailbox) return;

            db[sourceArray].splice(location.index, 1);
            record.mailbox = mailbox;
            record.trashedAt = null;
            record.previousMailbox = null;
            record.deletedAt = null;
            touch(record);

            if (!Array.isArray(db[mailbox])) db[mailbox] = [];
            db[mailbox].unshift(record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No messages moved." };
        }

        store.save(db);
        return { success: true, ids: changed, mailbox };
    }

    function setCategoryByIds(ids, categoryValue) {
        const raw = String(categoryValue || "").trim().toLowerCase();
        if (!isValidCategory(raw)) {
            return { success: false, error: "Invalid category." };
        }
        const category = raw;

        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isActive(location.record)) return;

            const record = location.record;
            if (record.mailbox !== "inbox") {
                if (location.arrayName !== "sent") return;
                db.sent.splice(location.index, 1);
                record.mailbox = "inbox";
                record.archivedAt = null;
                record.trashedAt = null;
                record.previousMailbox = null;
                db.inbox.unshift(record);
            }

            record.category = category;
            record.archivedAt = null;
            touch(record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No active messages found to categorize." };
        }

        store.save(db);
        return { success: true, ids: changed, category };
    }

    function archiveByIds(ids) {
        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isActive(location.record)) return;
            if (location.record.mailbox !== "inbox") return;
            location.record.archivedAt = Date.now();
            touch(location.record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No active Inbox messages found to archive." };
        }

        store.save(db);
        return { success: true, ids: changed };
    }

    function createLevel(name) {
        const label = String(name || "").trim();
        if (!label) {
            return { success: false, error: "Level name is required." };
        }

        const db = store.load();
        if (!Array.isArray(db.levels)) db.levels = [];

        const exists = db.levels.some((level) => String(level.name).toLowerCase() === label.toLowerCase());
        if (exists) {
            return { success: false, error: "A level with this name already exists." };
        }

        const level = normalizeLevel({ id: createLevelId(), name: label, parentId: null });
        db.levels.push(level);
        store.save(db);
        return { success: true, level };
    }

    function renameLevel(levelId, name) {
        const id = String(levelId || "").trim();
        const label = String(name || "").trim();
        if (!id || !label) {
            return { success: false, error: "Level id and name are required." };
        }

        const db = store.load();
        const level = findLevel(db, id);
        if (!level) {
            return { success: false, error: "Level not found." };
        }

        const duplicate = (db.levels || []).some(
            (item) => item.id !== id && String(item.name).toLowerCase() === label.toLowerCase()
        );
        if (duplicate) {
            return { success: false, error: "A level with this name already exists." };
        }

        level.name = label;
        level.updatedAt = Date.now();
        store.save(db);
        return { success: true, level };
    }

    function deleteLevel(levelId) {
        const id = String(levelId || "").trim();
        if (!id) {
            return { success: false, error: "Level id is required." };
        }

        const db = store.load();
        const level = findLevel(db, id);
        if (!level) {
            return { success: false, error: "Level not found." };
        }

        let released = 0;
        ["inbox", "sent", "drafts"].forEach((arrayName) => {
            const list = Array.isArray(db[arrayName]) ? db[arrayName] : [];
            list.forEach((record) => {
                if (record && record.levelId === id) {
                    record.levelId = null;
                    record.updatedAt = Date.now();
                    released += 1;
                }
            });
        });

        db.levels = (db.levels || []).filter((item) => item.id !== id);
        store.save(db);
        return { success: true, id, releasedCount: released };
    }

    function moveToLevelByIds(ids, levelId) {
        const targetLevelId = String(levelId || "").trim();
        if (!targetLevelId) {
            return { success: false, error: "Level id is required." };
        }

        const db = store.load();
        if (!findLevel(db, targetLevelId)) {
            return { success: false, error: "Level not found." };
        }

        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isActive(location.record)) return;

            const record = location.record;
            if (record.mailbox !== "inbox") {
                if (location.arrayName !== "sent") return;
                db.sent.splice(location.index, 1);
                record.mailbox = "inbox";
                record.trashedAt = null;
                record.previousMailbox = null;
                db.inbox.unshift(record);
            }

            record.levelId = targetLevelId;
            record.archivedAt = null;
            touch(record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No active messages found to move." };
        }

        store.save(db);
        return { success: true, ids: changed, levelId: targetLevelId };
    }

    function removeFromLevelByIds(ids) {
        const db = store.load();
        const changed = [];

        ids.forEach((id) => {
            const location = store.findRecordLocation(db, id);
            if (!location || !location.record || !store.isActive(location.record)) return;
            if (!location.record.levelId) return;
            location.record.levelId = null;
            touch(location.record);
            changed.push(id);
        });

        if (!changed.length) {
            return { success: false, error: "No leveled messages found." };
        }

        store.save(db);
        return { success: true, ids: changed };
    }

    function performAction(action, ids, params) {
        const normalized = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];

        switch (action) {
            case "trash":
                return trashByIds(normalized);
            case "restore":
                return restoreByIds(normalized);
            case "delete_permanently":
                return deletePermanentlyByIds(normalized);
            case "empty_trash":
                return emptyTrash();
            case "move":
                return moveByIds(normalized, params && params.mailbox);
            case "set_category":
                return setCategoryByIds(normalized, params && params.category);
            case "archive":
                return archiveByIds(normalized);
            case "move_to_level":
                return moveToLevelByIds(normalized, params && params.levelId);
            case "remove_from_level":
                return removeFromLevelByIds(normalized);
            case "create_level":
                return createLevel(params && params.name);
            case "rename_level":
                return renameLevel(params && params.levelId, params && params.name);
            case "delete_level":
                return deleteLevel(params && params.levelId);
            default:
                return { success: false, error: `Unsupported action: ${action}` };
        }
    }

    return {
        trashDraftByIndex,
        trashByIds,
        restoreByIds,
        deletePermanentlyByIds,
        emptyTrash,
        moveByIds,
        setCategoryByIds,
        archiveByIds,
        createLevel,
        renameLevel,
        deleteLevel,
        moveToLevelByIds,
        removeFromLevelByIds,
        performAction
    };
}

module.exports = { createMailActions };
