process.on("uncaughtException", err => {
    console.error("UNCAUGHT ERROR:", err);
});

require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, "maildb.json");
const mpayDbPath = path.join(__dirname, "mpaydb.json");

const { createMailStore } = require("./server/mmail/MailStore");
const { createMailActions } = require("./server/mmail/MailActions");
const { parsedToIncoming, mergeIncomingInbox } = require("./server/mmail/MailSync");
const {
    buildGmailSearchQuery,
    categoryFromGmailLabels,
    normalizeSyncCategories,
    resolveIncomingCategory,
    shouldSyncIncoming
} = require("./server/mmail/GmailSyncSettings");

const mailStore = createMailStore(dbPath);
const mailActions = createMailActions(mailStore);

const mnotesDbPath = path.join(__dirname, "mnotes.json");
const { createMNotesStore } = require("./server/mnotes/MNotesStore");
const mnotesStore = createMNotesStore(mnotesDbPath);

function readDB() {
    return mailStore.load();
}

function saveDB(data) {
    return mailStore.save(data);
}

function readMpayDB() {
    if (!fs.existsSync(mpayDbPath)) {
        return { balance: 0, transactions: [] };
    }
    return JSON.parse(fs.readFileSync(mpayDbPath, "utf8"));
}

function saveMpayDB(data) {
    fs.writeFileSync(mpayDbPath, JSON.stringify(data, null, 2));
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/* MMail - SEND API */
/* MMail - SEND API (আপডেটেড ও সুরক্ষিত সংস্করণ) */
app.post("/send", async (req, res) => {
    let db = readDB();
    let mail = req.body; // ফ্রন্টএন্ড থেকে পাঠানো ডেটা (এতে mail.from থাকা দরকার)
    
    try {
        // ফ্রন্টএন্ড থেকে পাঠানো 'from' মেইল আইডিটি নিন, না থাকলে ডিফল্ট জিমেইল ব্যবহার হবে
        const senderIdentity = mail.from || "lksamanta@mmail.in"; 

        await transporter.sendMail({
            // জিমেইল মাস্কিং ট্রিক: "lksamanta@mmail.in <lk.samanta1969@gmail.com>"
            from: `"${senderIdentity}" <${process.env.EMAIL_USER}>`, 
            to: mail.to,
            cc: mail.cc,
            subject: mail.subject,
            text: mail.msg,
            // Replies must land in the real Gmail mailbox that IMAP syncs
            replyTo: process.env.EMAIL_USER
        });

        // ডেটাবেজে সেভ করার আগে নিশ্চিত করুন কার কাছ থেকে পাঠানো হয়েছে
        mail.from = senderIdentity;
        const sentRecord = mailStore.prepareNewRecord(mail, "sent");
        db.sent.unshift(sentRecord);
        saveDB(db);
        
        res.json({ success: true, message: "Mail sent successfully" });
    } catch (err) {
        console.error("MAIL ERROR:", err);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

/* MMail - SAVE DRAFT */
app.post("/draft", (req, res) => {
    const db = readDB();
    if (!db.drafts) db.drafts = [];
    const draftRecord = mailStore.prepareNewRecord(req.body, "drafts");
    db.drafts.unshift(draftRecord);
    saveDB(db);
    res.json({ success: true, message: "Draft saved" });
});

app.get("/sent", (req, res) => {
    const db = readDB();
    res.json(mailStore.getActiveSent(db));
});

app.get("/draft", (req, res) => {
    const db = readDB();
    res.json(mailStore.getActiveDrafts(db));
});

app.post("/deleteDraft", (req, res) => {
    const index = Number(req.body && req.body.index);
    if (!Number.isInteger(index) || index < 0) {
        return res.json({ success: false, error: "Invalid draft index." });
    }
    const result = mailActions.trashDraftByIndex(index);
    if (!result.success) {
        return res.json(result);
    }
    res.json({ success: true, message: "Moved to Trash", id: result.id });
});

app.get("/inbox", (req, res) => {
    const db = readDB();
    const category = req.query && req.query.category;
    const smartTag = req.query && req.query.smartTag;
    const smartView = req.query && req.query.smartView;
    const levelId = req.query && req.query.levelId;
    res.json(mailStore.getActiveInbox(db, { category, smartTag, smartView, levelId }));
});

app.get("/mmail/levels", (req, res) => {
    const db = readDB();
    res.json({ success: true, levels: mailStore.getLevels(db) });
});

app.get("/mmail/inbox/meta", (req, res) => {
    const db = readDB();
    const activeInbox = mailStore.getActiveInbox(db);
    res.json({
        success: true,
        inboxTotal: activeInbox.length,
        categories: mailStore.getInboxCategoryCounts(db),
        smartViews: mailStore.getSmartViewCounts(db),
        archived: mailStore.getArchivedCount(db),
        levels: mailStore.getLevels(db)
    });
});

app.get("/mmail/sync-settings", (req, res) => {
    const db = readDB();
    res.json({ success: true, categories: normalizeSyncCategories(db.syncCategories) });
});

app.put("/mmail/sync-settings", (req, res) => {
    const db = readDB();
    db.syncCategories = normalizeSyncCategories(req.body && req.body.categories);
    saveDB(db);
    res.json({ success: true, categories: db.syncCategories });
});

app.get("/mmail/trash", (req, res) => {
    const db = readDB();
    res.json({ success: true, items: mailStore.getTrashItems(db) });
});

app.post("/mmail/actions", (req, res) => {
    const action = String((req.body && req.body.action) || "").trim();
    const ids = (req.body && req.body.ids) || [];
    const params = (req.body && req.body.params) || undefined;
    const result = mailActions.performAction(action, ids, params);
    res.json(result);
});

/* GMAIL IMAP SYNC — merges into local inbox by Message-ID (preserves trash/category/state) */
function runImapInboxSync(res) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        const message = "IMAP credentials missing. Set EMAIL_USER and EMAIL_PASS in .env for incoming mail sync.";
        if (res) return res.status(503).json({ success: false, error: message, items: mailStore.getActiveInbox(readDB()) });
        return Promise.reject(new Error(message));
    }

    const dbForSettings = readDB();
    const syncCategories = normalizeSyncCategories(dbForSettings.syncCategories);
    const searchQuery = buildGmailSearchQuery(syncCategories);
    if (!searchQuery) {
        const payload = { success: true, added: 0, updated: 0, skipped: 0, items: mailStore.getActiveInbox(dbForSettings) };
        if (res) return res.json(payload);
        return Promise.resolve(payload);
    }

    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: process.env.EMAIL_USER,
            password: process.env.EMAIL_PASS,
            host: "imap.gmail.com",
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }
        });

        imap.once("ready", () => {
            imap.openBox("INBOX", true, (err) => {
                if (err) {
                    imap.end();
                    return reject(err);
                }

                imap.search([["X-GM-RAW", searchQuery]], (searchErr, results) => {
                    if (searchErr) {
                        imap.end();
                        return reject(searchErr);
                    }

                    if (!results || results.length === 0) {
                        imap.end();
                        const db = readDB();
                        return resolve({
                            success: true,
                            added: 0,
                            updated: 0,
                            items: mailStore.getActiveInbox(db)
                        });
                    }

                    const uids = results.slice(-50);
                    const fetch = imap.fetch(uids, { bodies: "", struct: true });
                    const parsePromises = [];

                    fetch.on("message", (msg) => {
                        let gmailLabels = [];
                        msg.once("attributes", (attributes) => {
                            gmailLabels = attributes["x-gm-labels"] || [];
                        });
                        msg.on("body", (stream) => {
                            const p = new Promise((resolveMessage) => {
                                simpleParser(stream, (parseErr, parsed) => {
                                    if (parseErr || !parsed) return resolveMessage(null);
                                    const gmailCategory = categoryFromGmailLabels(gmailLabels)
                                        || (searchQuery === "in:inbox category:primary" ? "primary" : null);
                                    const incoming = parsedToIncoming(parsed, { gmailCategory });
                                    incoming.category = resolveIncomingCategory(incoming);
                                    resolveMessage(shouldSyncIncoming(incoming, syncCategories) ? incoming : null);
                                });
                            });
                            parsePromises.push(p);
                        });
                    });

                    fetch.once("error", (fetchErr) => {
                        imap.end();
                        reject(fetchErr);
                    });

                    fetch.once("end", async () => {
                        try {
                            const incoming = (await Promise.all(parsePromises)).filter(Boolean);
                            incoming.reverse();
                            const db = readDB();
                            const mergeStats = mergeIncomingInbox(db, mailStore, incoming);
                            saveDB(db);
                            mailStore.reload();
                            imap.end();
                            resolve({
                                success: true,
                                added: mergeStats.added,
                                updated: mergeStats.updated,
                                items: mailStore.getActiveInbox(db)
                            });
                        } catch (mergeErr) {
                            imap.end();
                            reject(mergeErr);
                        }
                    });
                });
            });
        });

        imap.once("error", (imapErr) => reject(imapErr));
        imap.connect();
    }).then((payload) => {
        if (res) res.json(payload);
        return payload;
    }).catch((err) => {
        console.error("[MMAIL] IMAP sync failed:", err.message || err);
        const fallback = {
            success: false,
            error: String(err.message || err),
            items: mailStore.getActiveInbox(readDB())
        };
        if (res) res.status(500).json(fallback);
        return fallback;
    });
}

app.get("/syncInbox", (req, res) => {
    runImapInboxSync(res);
});

/* M-PAY ENGINE APIS */
app.get("/mpay", (req, res) => res.json(readMpayDB()));

app.post("/mpayBalance", (req, res) => {
    let data = readMpayDB();
    data.balance = req.body.balance;
    saveMpayDB(data);
    res.send("Balance Saved");
});

app.post("/mpayAddMoney", (req, res) => {
    let data = readMpayDB();
    data.balance += parseFloat(req.body.amount || 0);
    data.transactions.push(`Modified/Added Wallet: ₹${req.body.amount}`);
    saveMpayDB(data);
    res.json(data);
});

app.get("/mpayHistory", (req, res) => res.json(readMpayDB().transactions));

/* MNOTES APIS */
app.get("/mnotes", (req, res) => {
    try {
        res.json({ success: true, notes: mnotesStore.listNotes() });
    } catch (error) {
        console.error("[MNOTES] List failed:", error);
        res.status(500).json({ success: false, error: "Failed to load notes." });
    }
});

app.get("/mnotes/:id", (req, res) => {
    try {
        const note = mnotesStore.getNote(String(req.params.id || "").trim());
        if (!note) {
            return res.status(404).json({ success: false, error: "Note not found." });
        }
        res.json({ success: true, note });
    } catch (error) {
        console.error("[MNOTES] Read failed:", error);
        res.status(500).json({ success: false, error: "Failed to load note." });
    }
});

app.post("/mnotes/import-legacy", (req, res) => {
    try {
        const content = req.body && req.body.content;
        const result = mnotesStore.importLegacyContent(content);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (error) {
        console.error("[MNOTES] Legacy import failed:", error);
        res.status(500).json({ success: false, error: "Failed to import legacy notes." });
    }
});

app.post("/mnotes", (req, res) => {
    try {
        const title = req.body && req.body.title;
        const content = req.body && req.body.content;
        if (!String(title || "").trim() && !String(content || "").trim()) {
            return res.status(400).json({ success: false, error: "Title or content is required." });
        }
        const note = mnotesStore.createNote({ title, content });
        res.json({ success: true, note });
    } catch (error) {
        console.error("[MNOTES] Create failed:", error);
        res.status(500).json({ success: false, error: "Failed to create note." });
    }
});

app.put("/mnotes/:id", (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        const title = req.body && req.body.title;
        const content = req.body && req.body.content;
        if (!String(title || "").trim() && !String(content || "").trim()) {
            return res.status(400).json({ success: false, error: "Title or content is required." });
        }
        const note = mnotesStore.updateNote(id, { title, content });
        if (!note) {
            return res.status(404).json({ success: false, error: "Note not found." });
        }
        res.json({ success: true, note });
    } catch (error) {
        console.error("[MNOTES] Update failed:", error);
        res.status(500).json({ success: false, error: "Failed to update note." });
    }
});

app.use(express.static(__dirname));

app.listen(3000, () => {
    console.log("SERVER RUNNING ON PORT 3000");
});
