const { CORE_CATEGORIES, classifyCategory, normalizeCategory } = require("./MailClassifier");

const DEFAULT_SYNC_CATEGORIES = Object.freeze(
    CORE_CATEGORIES.reduce((settings, category) => {
        settings[category] = category === "primary";
        return settings;
    }, {})
);

const GMAIL_NATIVE_CATEGORIES = new Set(["primary", "social", "promotions", "updates", "forums"]);

function normalizeSyncCategories(value) {
    const source = value && typeof value === "object" ? value : {};
    const normalized = {};
    CORE_CATEGORIES.forEach((category) => {
        normalized[category] = typeof source[category] === "boolean"
            ? source[category]
            : DEFAULT_SYNC_CATEGORIES[category];
    });
    return normalized;
}

function getEnabledSyncCategories(value) {
    const settings = normalizeSyncCategories(value);
    return CORE_CATEGORIES.filter((category) => settings[category]);
}

function buildGmailSearchQuery(value) {
    const enabled = getEnabledSyncCategories(value);
    const nativeEnabled = enabled.filter((category) => GMAIL_NATIVE_CATEGORIES.has(category));
    const hasLocalOnlyCategory = enabled.some((category) => !GMAIL_NATIVE_CATEGORIES.has(category));

    // Preserve the verified original query for the default Primary-only setting.
    if (nativeEnabled.length === 1 && nativeEnabled[0] === "primary" && !hasLocalOnlyCategory) {
        return "in:inbox category:primary";
    }

    // Gmail exposes only its five inbox tabs. Local-only categories are selected
    // after parsing, so their enabled state requires the Inbox candidate set.
    if (hasLocalOnlyCategory) return "in:inbox";
    if (!nativeEnabled.length) return null;
    return `in:inbox {${nativeEnabled.map((category) => `category:${category}`).join(" ")}}`;
}

function categoryFromGmailLabels(labels) {
    const labelSet = new Set((Array.isArray(labels) ? labels : []).map((label) => String(label).toUpperCase()));
    const mapping = {
        CATEGORY_SOCIAL: "social",
        CATEGORY_PROMOTIONS: "promotions",
        CATEGORY_UPDATES: "updates",
        CATEGORY_FORUMS: "forums",
        CATEGORY_PRIMARY: "primary",
        CATEGORY_PERSONAL: "primary"
    };
    const matchedLabel = Object.keys(mapping).find((label) => labelSet.has(label));
    return matchedLabel ? mapping[matchedLabel] : null;
}

function resolveIncomingCategory(incoming) {
    if (incoming && incoming.gmailCategory) return normalizeCategory(incoming.gmailCategory);
    return classifyCategory(incoming || {});
}

function shouldSyncIncoming(incoming, value) {
    const enabled = new Set(getEnabledSyncCategories(value));
    if (!enabled.size) return false;
    const gmailCategory = incoming && incoming.gmailCategory
        ? normalizeCategory(incoming.gmailCategory)
        : null;
    const localCategory = classifyCategory(incoming || {});
    return enabled.has(gmailCategory) || enabled.has(localCategory);
}

module.exports = {
    DEFAULT_SYNC_CATEGORIES,
    buildGmailSearchQuery,
    categoryFromGmailLabels,
    getEnabledSyncCategories,
    normalizeSyncCategories,
    resolveIncomingCategory,
    shouldSyncIncoming
};
