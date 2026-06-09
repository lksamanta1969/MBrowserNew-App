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
app.use(express.static(__dirname));

const dbPath = path.join(__dirname, "maildb.json");
const mpayDbPath = path.join(__dirname, "mpaydb.json");

function readDB() {
    if (!fs.existsSync(dbPath)) {
        return { sent: [], drafts: [], inbox: [] };
    }
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function saveDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
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
            // কেউ এই মেইলে রিপ্লাই দিলে যাতে আপনার মেইল সিস্টেমে আসে
            replyTo: senderIdentity 
        });

        // ডেটাবেজে সেভ করার আগে নিশ্চিত করুন কার কাছ থেকে পাঠানো হয়েছে
        mail.from = senderIdentity;
        db.sent.unshift(mail);
        saveDB(db);
        
        res.json({ success: true, message: "Mail sent successfully" });
    } catch (err) {
        console.error("MAIL ERROR:", err);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

/* MMail - SAVE DRAFT */
app.post("/draft", (req, res) => {
    let db = readDB();
    if (!db.drafts) db.drafts = [];
    db.drafts.unshift(req.body);
    saveDB(db);
    res.json({ success: true, message: "Draft saved" });
});

app.get("/sent", (req, res) => res.json(readDB().sent || []));
app.get("/draft", (req, res) => res.json(readDB().drafts || []));

app.post("/deleteDraft", (req, res) => {
    let db = readDB();
    if (db.drafts && db.drafts.length > req.body.index) {
        db.drafts.splice(req.body.index, 1);
        saveDB(db);
    }
    res.json({ success: true, message: "Deleted" });
});

app.get("/inbox", (req, res) => res.json(readDB().inbox || []));

/* GMAIL LIVE IMAP SYNC ENGINE (সুরক্ষিত প্রমিজ ভিত্তিক রেস-কন্ডিশন ফিক্স) */
app.get("/syncInbox", (req, res) => {
    const imap = new Imap({
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASS,
        host: "imap.gmail.com",
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    });

    imap.once("ready", () => {
        imap.openBox("INBOX", false, (err, box) => {
            if (err) { imap.end(); return res.status(500).send(err.toString()); }

            imap.search(["ALL"], (err, results) => {
                if (err) { imap.end(); return res.status(500).send(err.toString()); }
                if (!results || results.length === 0) {
                    let db = readDB(); db.inbox = []; saveDB(db);
                    imap.end(); return res.json([]);
                }

                const fetch = imap.fetch(results.slice(-20), { bodies: "" });
                let parsePromises = [];

                fetch.on("message", (msg) => {
                    msg.on("body", (stream) => {
                        const p = new Promise((resolve) => {
                            simpleParser(stream, (err, parsed) => {
                                if (parsed) {
                                    resolve({
                                        from: parsed.from?.text || "",
                                        subject: parsed.subject || "",
                                        msg: (parsed.text || parsed.html || "")
                                            .replace(/https?:\/\/\S+/g, "")
                                            .replace(/\s+/g, " ")
                                            .trim()
                                            .substring(0, 150),
                                        date: parsed.date || ""
                                    });
                                } else { resolve(null); }
                            });
                        });
                        parsePromises.push(p);
                    });
                });

                fetch.once("end", async () => {
                    let mails = await Promise.all(parsePromises);
                    mails = mails.filter(m => m !== null).reverse(); 
                    let db = readDB();
                    db.inbox = mails;
                    saveDB(db);
                    res.json(mails);
                    imap.end();
                });
            });
        });
    });

    imap.once("error", (err) => {
        if (!res.headersSent) res.status(500).send(err.toString());
    });
    imap.connect();
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

app.listen(3000, () => {
    console.log("SERVER RUNNING ON PORT 3000");
});