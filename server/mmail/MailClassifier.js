const CORE_CATEGORIES = [
    "primary",
    "social",
    "promotions",
    "updates",
    "forums",
    "shopping",
    "finance",
    "travel",
    "work",
    "personal"
];

const SMART_TAGS = ["receipt", "bills", "notification", "subscription"];

const SMART_VIEWS = [
    "unread",
    "starred",
    "important",
    "attachments",
    "receipt",
    "bills",
    "notification",
    "subscription"
];

const SOCIAL_DOMAINS = [
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "pinterest.com",
    "reddit.com",
    "snapchat.com"
];

const SHOPPING_DOMAINS = [
    "amazon.",
    "ebay.",
    "flipkart.",
    "myntra.",
    "shopify.",
    "etsy.",
    "walmart.",
    "target.",
    "aliexpress."
];

const SHOPPING_SUBJECT = [
    /\byour order\b/i,
    /\border confirmation\b/i,
    /\bshipped\b/i,
    /\bdelivery\b/i,
    /\btracking\b/i,
    /\bcart\b/i,
    /\bshop\b/i
];

const PROMOTION_SUBJECT = [
    /\bsale\b/i,
    /\boffer\b/i,
    /\bdiscount\b/i,
    /\bcoupon\b/i,
    /\bdeal\b/i,
    /\blimited time\b/i,
    /\bfree shipping\b/i,
    /\bshop now\b/i,
    /\b% off\b/i,
    /\bflash sale\b/i
];

const PROMOTION_SENDER = [
    "promo",
    "promotions",
    "marketing",
    "deals",
    "newsletter",
    "offers"
];

const UPDATE_SUBJECT = [
    /\balert\b/i,
    /\bnotification\b/i,
    /\bstatus update\b/i,
    /\baccount update\b/i,
    /\bdelivery update\b/i,
    /\bshipment\b/i,
    /\bverification\b/i,
    /\bsecurity alert\b/i,
    /\bpassword reset\b/i,
    /\bsign[- ]in\b/i,
    /\bconfirm your\b/i
];

const FORUM_SUBJECT = [
    /\bmailing list\b/i,
    /\blist-id\b/i,
    /\bdiscussion\b/i,
    /\bforum\b/i,
    /\bcommunity update\b/i,
    /\bunsubscribe\b/i
];

const FORUM_SENDER = [
    "lists.",
    "list.",
    "forum",
    "discuss",
    "groups.google",
    "mailman"
];

const TRAVEL_SUBJECT = [
    /\bflight\b/i,
    /\btrain\b/i,
    /\bhotel\b/i,
    /\bbooking\b/i,
    /\bboarding\b/i,
    /\bpnr\b/i,
    /\bitinerary\b/i,
    /\breservation\b/i
];

const TRAVEL_DOMAINS = ["booking.com", "expedia.", "airbnb.", "makemytrip.", "goibibo.", "irctc."];

const FINANCE_SUBJECT = [
    /\bbank\b/i,
    /\btransaction\b/i,
    /\bdebit\b/i,
    /\bcredit\b/i,
    /\bstatement\b/i,
    /\bpayment\b/i,
    /\bupi\b/i,
    /\baccount\b/i
];

const FINANCE_DOMAINS = ["paypal.com", "stripe.com", "bank", "chase.com", "wellsfargo.com", "hdfcbank", "icicibank"];

const WORK_SUBJECT = [
    /\bmeeting\b/i,
    /\binterview\b/i,
    /\bproject\b/i,
    /\bdeadline\b/i,
    /\boffer letter\b/i,
    /\bwork\b/i,
    /\boffice\b/i
];

const WORK_DOMAINS = ["work.", "corp.", "enterprise.", "company."];

const PERSONAL_SUBJECT = [
    /\bbirthday\b/i,
    /\bfamily\b/i,
    /\bhappy birthday\b/i,
    /\bget well\b/i,
    /\bcongratulations\b/i
];

const SMART_RULES = {
    receipt: [/\breceipt\b/i, /\binvoice\b/i, /\border confirmation\b/i, /\bpayment receipt\b/i],
    bills: [
        /\bbill\b/i,
        /\bbank\b/i,
        /\btransaction\b/i,
        /\bdebit\b/i,
        /\bcredit\b/i,
        /\bstatement\b/i,
        /\bpayment\b/i,
        /\bupi\b/i
    ],
    notification: [/\bnotification\b/i, /\balert\b/i, /\breminder\b/i, /\bverification\b/i, /\bsecurity\b/i],
    subscription: [/\bsubscription\b/i, /\brenewal\b/i, /\bunsubscribe\b/i, /\bmembership\b/i]
};

const ATTACHMENT_SUBJECT = [/\battachment\b/i, /\battached\b/i, /\bsee attached\b/i, /\bfile attached\b/i];

const IMPORTANT_SUBJECT = [/\bimportant\b/i, /\burgent\b/i, /\baction required\b/i, /\bpriority\b/i];

function extractDomain(from) {
    const text = String(from || "").toLowerCase();
    const match = text.match(/@([\w.-]+\.\w+)/);
    return match ? match[1] : "";
}

function extractLocalPart(from) {
    const text = String(from || "").toLowerCase();
    const match = text.match(/^[\w.+-]+/);
    return match ? match[0] : text;
}

function subjectText(record) {
    return String(record.subject || "").trim();
}

function matchesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
}

function domainMatches(domain, candidates) {
    if (!domain) return false;
    return candidates.some((part) => domain === part || domain.endsWith("." + part) || domain.includes(part));
}

function detectSmartTags(record) {
    const subject = subjectText(record);
    const domain = extractDomain(record.from);
    const tags = new Set();

    Object.keys(SMART_RULES).forEach((tag) => {
        if (matchesAny(subject, SMART_RULES[tag])) tags.add(tag);
    });

    if (domainMatches(domain, FINANCE_DOMAINS) && matchesAny(subject, [/\bpayment\b/i, /\btransaction\b/i, /\bstatement\b/i])) {
        tags.add("bills");
    }

    if (Array.isArray(record.smartTags)) {
        record.smartTags.forEach((legacy) => {
            const tag = String(legacy).toLowerCase();
            if (tag === "finance") tags.add("bills");
            else if (SMART_TAGS.includes(tag)) tags.add(tag);
        });
    }

    return Array.from(tags);
}

function detectHasAttachments(record) {
    if (record.hasAttachments === true) return true;
    return matchesAny(subjectText(record), ATTACHMENT_SUBJECT);
}

function detectImportant(record) {
    if (record.important === true) return true;
    return matchesAny(subjectText(record), IMPORTANT_SUBJECT);
}

function classifyCategory(record) {
    const from = String(record.from || "").toLowerCase();
    const subject = subjectText(record);
    const domain = extractDomain(from);
    const local = extractLocalPart(from);

    if (domainMatches(domain, SOCIAL_DOMAINS)) return "social";

    if (
        matchesAny(subject, FORUM_SUBJECT) ||
        FORUM_SENDER.some((part) => from.includes(part) || domain.includes(part))
    ) {
        return "forums";
    }

    const promoSubjectHit = matchesAny(subject, PROMOTION_SUBJECT);
    const promoSenderHit = PROMOTION_SENDER.some((part) => local.includes(part) || domain.includes(part));
    if (promoSubjectHit && (promoSenderHit || matchesAny(subject, [/\bunsubscribe\b/i]))) {
        return "promotions";
    }
    if (promoSubjectHit && matchesAny(subject, [/\bsale\b/i, /\bdiscount\b/i, /\boffer\b/i, /\bdeal\b/i])) {
        return "promotions";
    }

    if (matchesAny(subject, UPDATE_SUBJECT)) return "updates";

    if (
        matchesAny(subject, TRAVEL_SUBJECT) ||
        domainMatches(domain, TRAVEL_DOMAINS)
    ) {
        return "travel";
    }

    if (
        domainMatches(domain, SHOPPING_DOMAINS) ||
        (matchesAny(subject, SHOPPING_SUBJECT) && !promoSubjectHit)
    ) {
        return "shopping";
    }

    if (
        matchesAny(subject, FINANCE_SUBJECT) ||
        domainMatches(domain, FINANCE_DOMAINS)
    ) {
        return "finance";
    }

    if (
        matchesAny(subject, WORK_SUBJECT) ||
        domainMatches(domain, WORK_DOMAINS) ||
        local.includes("hr") ||
        local.includes("jobs") ||
        local.includes("careers")
    ) {
        return "work";
    }

    if (matchesAny(subject, PERSONAL_SUBJECT)) {
        return "personal";
    }

    return "primary";
}

function classifyMessage(record) {
    const smartTags = detectSmartTags(record);
    const category = classifyCategory(record);
    const hasAttachments = detectHasAttachments(record);
    return { category, smartTags, hasAttachments };
}

function isValidCategory(value) {
    return CORE_CATEGORIES.includes(String(value || "").toLowerCase());
}

function normalizeCategory(value) {
    const normalized = String(value || "primary").toLowerCase();
    return isValidCategory(normalized) ? normalized : "primary";
}

function normalizeSmartTags(value) {
    if (!Array.isArray(value)) return [];
    const tags = new Set();
    value.forEach((raw) => {
        const tag = String(raw).toLowerCase();
        if (tag === "finance") tags.add("bills");
        else if (SMART_TAGS.includes(tag)) tags.add(tag);
    });
    return Array.from(tags);
}

function isValidSmartView(value) {
    return SMART_VIEWS.includes(String(value || "").toLowerCase());
}

function recordMatchesSmartView(record, view) {
    const key = String(view || "").toLowerCase();
    if (!isValidSmartView(key)) return false;

    switch (key) {
        case "unread":
            return record.isRead === false;
        case "starred":
            return record.starred === true;
        case "important":
            return record.important === true;
        case "attachments":
            return record.hasAttachments === true;
        default:
            return Array.isArray(record.smartTags) && record.smartTags.includes(key);
    }
}

module.exports = {
    CORE_CATEGORIES,
    SMART_TAGS,
    SMART_VIEWS,
    classifyMessage,
    classifyCategory,
    detectSmartTags,
    detectHasAttachments,
    detectImportant,
    isValidCategory,
    normalizeCategory,
    normalizeSmartTags,
    isValidSmartView,
    recordMatchesSmartView
};
