const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function setup(){
 const html=fs.readFileSync(path.join(__dirname,'../../apps/mmail/index.html'),'utf8');
 const start=html.indexOf('async function loadInboxMessages(options) {');const end=html.indexOf('async function loadInbox(){',start);
 const requests=[],notices=[],renders=[];let counts=0;
 const ctx=vm.createContext({currentMailboxView:'level:test',clearSelection(){},document:{getElementById:()=>({})},
  fetch:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
  renderMailboxLoadStatus:(title,message)=>notices.push({title,message}),renderSelectableMailList:x=>renders.push(x),refreshSidebarCounts:async()=>{counts++;}});
 vm.runInContext(html.slice(start,end),ctx);
 return {ctx,requests,notices,renders,counts:()=>counts};
}
const options={sync:false,url:'http://localhost:3000/inbox?levelId=test',title:'Test Level',emptyText:'No messages in this level.'};
test('shared non-sync loader shows correct title and loading feedback',async()=>{
 const h=setup();const p=h.ctx.loadInboxMessages(options);
 assert.equal(h.notices[0].title,'Test Level');assert.equal(h.notices[0].message,'Loading messages...');
 h.requests[0].resolve({ok:true,json:async()=>[]});await p;
 assert.equal(h.renders[0].emptyText,options.emptyText);assert.equal(h.counts(),1);
});
test('HTTP error gets inline retry feedback rather than a mail list',async()=>{
 const h=setup();const p=h.ctx.loadInboxMessages(options);h.requests[0].resolve({ok:false});await p;
 assert.equal(h.renders.length,0);assert.match(h.notices.at(-1).message,/Select this mailbox again/);
});
test('invalid JSON payload shape is not treated as an empty mailbox',async()=>{
 const h=setup();const p=h.ctx.loadInboxMessages(options);h.requests[0].resolve({ok:true,json:async()=>({error:'bad'})});await p;
 assert.equal(h.renders.length,0);assert.match(h.notices.at(-1).message,/Could not load messages/);
});
test('old mailbox failure does not replace newly selected mailbox',async()=>{
 const h=setup();const p=h.ctx.loadInboxMessages(options);h.ctx.currentMailboxView='sent';
 h.requests[0].reject(Error('offline'));await p;
 assert.equal(h.notices.length,1);assert.equal(h.renders.length,0);
});
test('valid mail response preserves renderer options and sidebar refresh',async()=>{
 const h=setup();const p=h.ctx.loadInboxMessages({...options,showCategoryBulk:false});
 h.requests[0].resolve({ok:true,json:async()=>[{id:'sample'}]});await p;
 assert.equal(h.renders[0].items[0].id,'sample');assert.equal(h.renders[0].showCategoryBulk,false);assert.equal(h.counts(),1);
});
