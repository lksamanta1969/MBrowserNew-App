const crypto = require("crypto");

function createLevelId() {
    if (crypto.randomUUID) return `lvl_${crypto.randomUUID()}`;
    return `lvl_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeLevel(raw) {
    const level = raw && typeof raw === "object" ? { ...raw } : {};
    const now = Date.now();
    if (!level.id) level.id = createLevelId();
    level.name = String(level.name || "").trim();
    if (level.parentId === undefined) level.parentId = null;
    if (!level.createdAt) level.createdAt = now;
    if (!level.updatedAt) level.updatedAt = now;
    return level;
}

function normalizeLevels(levels) {
    if (!Array.isArray(levels)) return [];
    return levels.map(normalizeLevel).filter((level) => level.name);
}

function findLevel(db, levelId) {
    const levels = normalizeLevels(db.levels);
    return levels.find((level) => level.id === levelId) || null;
}

function countMailsInLevel(db, levelId, isActive) {
    const arrays = ["inbox", "sent", "drafts"];
    let count = 0;
    arrays.forEach((name) => {
        const list = Array.isArray(db[name]) ? db[name] : [];
        list.forEach((record) => {
            if (record && record.levelId === levelId && isActive(record)) count += 1;
        });
    });
    return count;
}

function getLevelsWithCounts(db, isActive) {
    return normalizeLevels(db.levels).map((level) => ({
        id: level.id,
        name: level.name,
        parentId: level.parentId,
        createdAt: level.createdAt,
        updatedAt: level.updatedAt,
        count: countMailsInLevel(db, level.id, isActive)
    }));
}

module.exports = {
    createLevelId,
    normalizeLevel,
    normalizeLevels,
    findLevel,
    getLevelsWithCounts,
    countMailsInLevel
};
