process.on("uncaughtException", err => {
    console.error("UNCAUGHT ERROR:", err);
});

process.on("exit", code => {
    console.log("PROCESS EXITED:", code);
});

console.log("SERVER FILE STARTED");

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

const dbPath = path.join(__dirname,"maildb.json");

console.log("DB PATH =", dbPath);
console.log("MAILDB EXISTS =", fs.existsSync(dbPath));
function readDB(){

  if(!fs.existsSync(dbPath)){
    return {
      sent: [],
      drafts: [],
      inbox: []
    };
  }

  return JSON.parse(fs.readFileSync(dbPath,"utf8"));

}

function saveDB(data){

  fs.writeFileSync(dbPath, JSON.stringify(data,null,2));

}


const transporter = nodemailer.createTransport({

service:"gmail",

auth:{

user:process.env.EMAIL_USER,

pass:process.env.EMAIL_PASS

}

});
transporter.verify(function(error, success){

  if(error){
    console.log("SMTP ERROR:", error);
  }else{
    console.log("SMTP READY");
  }

});

/* SEND */

app.post("/send", async (req,res)=>{

console.log("SEND API CALLED");

let db = readDB();

let mail=req.body;

console.log(mail);

try{

await transporter.sendMail({

from:process.env.EMAIL_USER,

to:mail.to,

cc:mail.cc,

subject:mail.subject,

text:mail.msg

});

console.log("MAIL SENT SUCCESS");

db.sent.unshift(mail);
  
saveDB(db);

res.send("Mail sent");

}

catch(err){

console.error("MAIL ERROR:", err);

res.status(500).send(err.toString());

}

});


/* SAVE DRAFT */

app.post("/draft",(req,res)=>{

let db = readDB();

db.drafts.unshift(req.body);

saveDB(db);

res.send("Draft saved");

});


/* GET SENT */

app.get("/sent",(req,res)=>{

    let db = readDB();

    console.log("SENT COUNT =", db.sent.length);

    res.json(db.sent);

});


/* GET DRAFT */

app.get("/draft",(req,res)=>{
  res.json(readDB().drafts);
});


/* DELETE DRAFT */

app.post("/deleteDraft",(req,res)=>{

let db = readDB();

db.drafts.splice(req.body.index,1);

saveDB(db);

res.send("deleted");

});


/* INBOX */

app.get("/inbox",(req,res)=>{

res.json(readDB().inbox);

});
/* SYNC INBOX FROM GMAIL */

app.get("/syncInbox",(req,res)=>{

const imap = new Imap({

user: process.env.EMAIL_USER,

password: process.env.EMAIL_PASS,

host: "imap.gmail.com",

port: 993,

tls: true,

tlsOptions: {
    rejectUnauthorized: false
}

});

imap.once("ready",()=>{

imap.openBox("INBOX",false,(err,box)=>{

if(err){
res.status(500).send(err.toString());
return;
}

imap.search(["ALL"],(err,results)=>{

if(err){
res.status(500).send(err.toString());
return;
}

if(!results || results.length===0){

let db=readDB();
db.inbox=[];
saveDB(db);

res.json([]);

imap.end();
return;
}

const fetch = imap.fetch(results.slice(-20),{
bodies:""
});

let mails=[];

fetch.on("message",(msg)=>{

msg.on("body",(stream)=>{

simpleParser(stream,async(err,parsed)=>{

if(parsed){

mails.unshift({

from: parsed.from?.text || "",

subject: parsed.subject || "",

msg:
(
  parsed.text ||
  parsed.html ||
  ""
)
.replace(/https?:\/\/\S+/g,"")
.replace(/\s+/g," ")
.trim()
.substring(0,150),

date: parsed.date || ""

});

}

});

});

});

fetch.once("end",()=>{

setTimeout(()=>{

let db=readDB();

db.inbox=mails;

saveDB(db);

res.json(mails);

imap.end();

},1000);

});

});

});

});

imap.once("error",(err)=>{

console.error("IMAP ERROR:", err);

if(!res.headersSent){
    res.status(500).send(err.toString());
}

});

imap.connect();

});

/* MPAY GET */

app.get("/mpay",(req,res)=>{

const data =
JSON.parse(
fs.readFileSync(
path.join(__dirname,"mpaydb.json"),
"utf8"
)
);

res.json(data);

});
/* MPAY SAVE BALANCE */

app.post("/mpayBalance",(req,res)=>{

let data = JSON.parse(
fs.readFileSync(
path.join(__dirname,"mpaydb.json"),
"utf8"
)
);

data.balance = req.body.balance;

fs.writeFileSync(
path.join(__dirname,"mpaydb.json"),
JSON.stringify(data,null,2)
);

res.send("Balance Saved");

});
/* MPAY ADD MONEY */

app.post("/mpayAddMoney",(req,res)=>{

let data = JSON.parse(
fs.readFileSync(
path.join(__dirname,"mpaydb.json"),
"utf8"
)
);

data.balance += req.body.amount;

data.transactions.push(
"Added ₹" + req.body.amount
);

fs.writeFileSync(
path.join(__dirname,"mpaydb.json"),
JSON.stringify(data,null,2)
);

res.json(data);

});

/* MPAY HISTORY */

app.get("/mpayHistory",(req,res)=>{

let data = JSON.parse(
fs.readFileSync(
path.join(__dirname,"mpaydb.json"),
"utf8"
)
);

res.json(data.transactions);

});

const server = app.listen(3000, "127.0.0.1", () => {
  console.log("SERVER RUNNING ON 127.0.0.1:3000");
});

server.on("error", (err) => {
  console.error("LISTEN ERROR:", err);
});
setInterval(() => {
    console.log("SERVER ALIVE");
}, 5000);