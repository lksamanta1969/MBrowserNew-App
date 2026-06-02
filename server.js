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

user:"lk.samanta1969@gmail.com",

pass:"vdfinekzztmltwug"

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

from:"lk.samanta1969@gmail.com",

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

res.json(readDB().sent);

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

user:"lk.samanta1969@gmail.com",

password:"vdfinekzztmltwug",

host:"imap.gmail.com",

port:993,

tls:true

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

msg: parsed.text || "",

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

app.listen(3000,()=>{

console.log("SERVER RUNNING");

});
