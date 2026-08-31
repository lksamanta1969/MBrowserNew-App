function normalizeReferences(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
}

function buildMessagePreview(parsed) {
    const body = parsed.text || parsed.html || "";
    return String(body)
        .replace(/<[^>]+>/g, " ")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 500);
}

function parsedToIncoming(parsed, options = {}) {
    if (!parsed) return null;
    return {
        from: (parsed.from && parsed.from.text) || "",
        to: (parsed.to && parsed.to.text) || "",
        cc: (parsed.cc && parsed.cc.text) || "",
        subject: parsed.subject || "",
        msg: buildMessagePreview(parsed),
        date: parsed.date || "",
        messageId: parsed.messageId || null,
        inReplyTo: parsed.inReplyTo || null,
        references: normalizeReferences(parsed.references),
        replyTo: (parsed.replyTo && parsed.replyTo.text) || "",
        gmailCategory: options.gmailCategory || null
    };
}

function mergeIncomingInbox(db, store, incomingList) {
    const byMessageId = new Map();
    if (!Array.isArray(db.inbox)) db.inbox = [];

    db.inbox.forEach((record) => {
        if (record && record.messageId) byMessageId.set(record.messageId, record);
    });

    let added = 0;
    let updated = 0;

    incomingList.forEach((incoming) => {
        if (!incoming) return;

        let existing = incoming.messageId ? byMessageId.get(incoming.messageId) : null;

        if (!existing) {
            existing = db.inbox.find(
                (record) =>
                    record &&
                    !record.deletedAt &&
                    record.from === incoming.from &&
                    record.subject === incoming.subject &&
                    String(record.date || "") === String(incoming.date || "")
            );
        }

        if (existing) {
            if (store.isPermanentlyDeleted(existing)) return;
            if (store.isInTrash(existing)) return;

            existing.from = incoming.from;
            existing.to = incoming.to;
            existing.cc = incoming.cc;
            existing.subject = incoming.subject;
            existing.msg = incoming.msg;
            existing.date = incoming.date;
            existing.messageId = incoming.messageId || existing.messageId;
            existing.inReplyTo = incoming.inReplyTo;
            existing.references = incoming.references;
            existing.replyTo = incoming.replyTo;
            existing.updatedAt = Date.now();
            updated += 1;
            return;
        }

        const record = store.prepareNewRecord({ ...incoming, syncCategory: true }, "inbox");
        db.inbox.unshift(record);
        if (record.messageId) byMessageId.set(record.messageId, record);
        added += 1;
    });

    return { added, updated, total: incomingList.length };
}

module.exports = {
    parsedToIncoming,
    mergeIncomingInbox
};
