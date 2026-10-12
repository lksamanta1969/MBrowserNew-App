const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function setup(){
  const html=fs.readFileSync(path.join(__dirname,'../../apps/mmail/index.html'),'utf8');
  const start=html.indexOf('let sentDraftLoadId = 0;');const end=html.indexOf('async function editDraft(',start);
  assert.ok(start>=0 && end>start);
  const requests=[],renders=[],alerts=[];
  const content={children:[],set innerHTML(v){this.children=[];},appendChild(n){this.children.push(n);}};
  const document={getElementById:()=>content,createElement:()=>({textContent:'',setAttribute(){}})};
  const ctx=vm.createContext({document,currentMailboxView:'inbox',setActiveNav(){},clearSelection(){},
    fetch:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
    renderSelectableMailList:x=>renders.push({view:'sent',...x}),renderMailList:x=>renders.push({view:'drafts',...x}),alert:x=>alerts.push(x)});
  vm.runInContext(html.slice(start,end),ctx);
  return {ctx,requests,renders,alerts,content};
}
const response=(items=[])=>({ok:true,json:async()=>items});
test('late Sent response cannot overwrite Drafts',async()=>{
  const h=setup();const sent=h.ctx.loadSent();const drafts=h.ctx.loadDrafts();
  h.requests[1].resolve(response([]));await drafts;h.requests[0].resolve(response([]));await sent;
  assert.equal(h.renders.length,1);assert.equal(h.renders[0].view,'drafts');
});
test('late Drafts response cannot overwrite Sent',async()=>{
  const h=setup();const drafts=h.ctx.loadDrafts();const sent=h.ctx.loadSent();
  h.requests[1].resolve(response([]));await sent;h.requests[0].resolve(response([]));await drafts;
  assert.equal(h.renders.length,1);assert.equal(h.renders[0].view,'sent');
});
test('late error from abandoned view produces no alert',async()=>{
  const h=setup();const sent=h.ctx.loadSent();h.ctx.currentMailboxView='inbox';h.requests[0].reject(Error('offline'));await sent;
  assert.equal(h.alerts.length,0);assert.equal(h.renders.length,0);
});
test('non-success HTTP response is not rendered as mail',async()=>{
  const h=setup();const p=h.ctx.loadDrafts();h.requests[0].resolve({ok:false,json:async()=>({error:'failure'})});await p;
  assert.equal(h.renders.length,0);assert.equal(h.alerts.length,0);assert.match(h.content.children[2].textContent,/Could not load Drafts/);
});
test('navigation during JSON parsing discards old response',async()=>{
  const h=setup();let resolveJson;const p=h.ctx.loadSent();
  h.requests[0].resolve({ok:true,json:()=>new Promise(r=>{resolveJson=r;})});
  await new Promise(r=>setImmediate(r));h.ctx.currentMailboxView='trash';resolveJson([]);await p;
  assert.equal(h.renders.length,0);
});
test('current Sent and Drafts preserve accepted renderer options',async()=>{
  const h=setup();const sent=h.ctx.loadSent();h.requests[0].resolve(response([]));await sent;
  assert.equal(h.renders[0].showCategoryBulk,false);assert.equal(h.renders[0].emptyText,'No sent messages.');
  const drafts=h.ctx.loadDrafts();h.requests[1].resolve(response([]));await drafts;
  assert.equal(h.renders[1].showEdit,true);assert.equal(h.renders[1].emptyText,'No draft logs available.');
});
test('current Sent HTTP failure is reported without rendering',async()=>{
  const h=setup();const p=h.ctx.loadSent();h.requests[0].resolve({ok:false});await p;
  assert.equal(h.renders.length,0);assert.match(h.content.children[2].textContent,/Could not load Sent/);
});


test('mailbox heading changes immediately with loading feedback',async()=>{
  const h=setup();const sent=h.ctx.loadSent();
  assert.match(h.content.children[0].textContent,/Sent Box/);
  assert.equal(h.content.children[2].textContent,'Loading messages...');
  const drafts=h.ctx.loadDrafts();assert.match(h.content.children[0].textContent,/Drafts/);
  h.requests[0].resolve(response([]));h.requests[1].resolve(response([]));await Promise.all([sent,drafts]);
});
test('network failure shows an inline retry message for current mailbox',async()=>{
  const h=setup();const p=h.ctx.loadDrafts();h.requests[0].reject(Error('offline'));await p;
  assert.match(h.content.children[0].textContent,/Drafts/);
  assert.match(h.content.children[2].textContent,/Select Drafts again/);
  assert.equal(h.alerts.length,0);
});
test('late failure cannot replace another mailbox loading notice',async()=>{
  const h=setup();const sent=h.ctx.loadSent();const drafts=h.ctx.loadDrafts();
  h.requests[0].reject(Error('offline'));await sent;
  assert.match(h.content.children[0].textContent,/Drafts/);
  assert.equal(h.content.children[2].textContent,'Loading messages...');
  h.requests[1].resolve(response([]));await drafts;
});


test('returning to Sent discards first Sent request even when view name matches',async()=>{
  const h=setup();const first=h.ctx.loadSent();const middle=h.ctx.loadDrafts();const latest=h.ctx.loadSent();
  h.requests[2].resolve(response([{id:'latest'}]));await latest;
  h.requests[0].resolve(response([{id:'old'}]));h.requests[1].resolve(response([]));await Promise.all([first,middle]);
  assert.equal(h.renders.length,1);assert.equal(h.renders[0].items[0].id,'latest');
});
test('returning to Drafts discards first Drafts request',async()=>{
  const h=setup();const first=h.ctx.loadDrafts();const middle=h.ctx.loadSent();const latest=h.ctx.loadDrafts();
  h.requests[2].resolve(response([{id:'latest'}]));await latest;
  h.requests[0].resolve(response([{id:'old'}]));h.requests[1].resolve(response([]));await Promise.all([first,middle]);
  assert.equal(h.renders.length,1);assert.equal(h.renders[0].items[0].id,'latest');
});
test('old same-view error cannot replace latest loading status',async()=>{
  const h=setup();const first=h.ctx.loadSent();const latest=h.ctx.loadSent();
  h.requests[0].reject(Error('old error'));await first;
  assert.equal(h.content.children[2].textContent,'Loading messages...');
  h.requests[1].resolve(response([]));await latest;assert.equal(h.renders.length,1);
});
