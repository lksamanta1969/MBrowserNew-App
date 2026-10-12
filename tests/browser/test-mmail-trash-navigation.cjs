const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function setup(){
 const html=fs.readFileSync(path.join(__dirname,'../../apps/mmail/index.html'),'utf8');
 const start=html.indexOf('let trashLoadId = 0;');const end=html.indexOf('async function restoreTrashItem(',start);
 const node=()=>({children:[],style:{},textContent:'',className:'',set innerHTML(v){this.children=[];},appendChild(x){x.parent=this;this.children.push(x);},remove(){this.parent.children=this.parent.children.filter(x=>x!==this);},setAttribute(){},addEventListener(){}});
 const content=node(),requests=[];
 const ctx=vm.createContext({currentMailboxView:'sent',setActiveNav(){},clearSelection(){},emptyTrash(){},restoreTrashItem(){},deleteTrashItemPermanently(){},
 document:{getElementById:()=>content,createElement:node,createTextNode:t=>({textContent:t})},console,
 fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))});
 vm.runInContext(html.slice(start,end),ctx);return {ctx,content,requests};
}
test('late Trash response cannot append to another mailbox',async()=>{
 const h=setup();const p=h.ctx.loadTrash();h.ctx.currentMailboxView='sent';h.content.children=[{textContent:'Sent'}];
 h.requests[0].resolve({ok:true,json:async()=>({items:[]})});await p;
 assert.equal(h.content.children.length,1);assert.equal(h.content.children[0].textContent,'Sent');
});
test('late Trash failure cannot append error to another mailbox',async()=>{
 const h=setup();const p=h.ctx.loadTrash();h.ctx.currentMailboxView='drafts';h.content.children=[{textContent:'Drafts'}];
 h.requests[0].reject(Error('offline'));await p;assert.equal(h.content.children.length,1);
});
test('latest Trash request wins over an earlier request to the same view',async()=>{
 const h=setup();const first=h.ctx.loadTrash();const latest=h.ctx.loadTrash();
 h.requests[1].resolve({ok:true,json:async()=>({items:[]})});await latest;const count=h.content.children.length;
 h.requests[0].resolve({ok:true,json:async()=>({items:[{id:'old',subject:'Old'}]})});await first;
 assert.equal(h.content.children.length,count);assert.equal(h.content.children.at(-1).textContent,'Trash is empty.');
});
test('navigation during Trash JSON parsing discards response',async()=>{
 const h=setup();let resolveJson;const p=h.ctx.loadTrash();h.requests[0].resolve({ok:true,json:()=>new Promise(r=>{resolveJson=r;})});
 await new Promise(r=>setImmediate(r));h.ctx.currentMailboxView='sent';h.content.children=[];resolveJson({items:[]});await p;
 assert.equal(h.content.children.length,0);
});
test('current Trash retains cards and restore/delete buttons',async()=>{
 const h=setup();const p=h.ctx.loadTrash();h.requests[0].resolve({ok:true,json:async()=>({items:[{id:'test',subject:'Test'}]})});await p;
 const card=h.content.children.find(x=>x.className==='mail-card');assert.ok(card);
 const actions=card.children.at(-1);assert.equal(actions.children[0].textContent,'Restore');assert.equal(actions.children[1].textContent,'Delete Permanently');
});


test('Trash shows loading and disables Empty Trash until valid data',async()=>{
 const h=setup();const p=h.ctx.loadTrash();
 assert.equal(h.content.children.at(-1).textContent,'Loading Trash...');
 assert.equal(h.content.children[2].children[0].disabled,true);
 h.requests[0].resolve({ok:true,json:async()=>({items:[{id:'sample'}]})});await p;
 assert.equal(h.content.children[2].children[0].disabled,false);
 assert.equal(h.content.children.some(x=>x.textContent==='Loading Trash...'),false);
});
test('Trash HTTP failure gives retry feedback and keeps Empty Trash disabled',async()=>{
 const h=setup();const p=h.ctx.loadTrash();h.requests[0].resolve({ok:false});await p;
 assert.match(h.content.children.at(-1).textContent,/Select Trash again/);
 assert.equal(h.content.children[2].children[0].disabled,true);
});
test('invalid Trash response cannot be misrepresented as empty',async()=>{
 const h=setup();const p=h.ctx.loadTrash();h.requests[0].resolve({ok:true,json:async()=>({error:'bad'})});await p;
 assert.match(h.content.children.at(-1).textContent,/Could not load Trash/);
 assert.equal(h.content.children[2].children[0].disabled,true);
});
