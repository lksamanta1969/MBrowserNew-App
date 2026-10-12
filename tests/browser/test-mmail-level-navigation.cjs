const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function setup(cached=null){
 const html=fs.readFileSync(path.join(__dirname,'../../apps/mmail/index.html'),'utf8');
 const start=html.indexOf('let levelMetadataLoadId = 0;');const end=html.indexOf('function getCategoryOptions()',start);
 const requests=[],loads=[],nav=[];
 const ctx=vm.createContext({currentMailboxView:'inbox',getLevelById:()=>cached,
  fetchLevels:()=>new Promise(resolve=>requests.push(resolve)),setActiveNav:id=>nav.push(id),loadInboxMessages:async o=>loads.push(o)});
 vm.runInContext(html.slice(start,end),ctx);return {ctx,requests,loads,nav};
}
test('abandoned Level metadata cannot change Sent navigation or list',async()=>{
 const h=setup();const p=h.ctx.loadLevel('test');h.ctx.currentMailboxView='sent';
 h.requests[0]([{id:'test',name:'Test Level'}]);await p;
 assert.equal(h.nav.length,0);assert.equal(h.loads.length,0);assert.equal(h.ctx.currentMailboxView,'sent');
});
test('latest Level request wins when returning to the same Level',async()=>{
 const h=setup();const first=h.ctx.loadLevel('test');const middle=h.ctx.loadLevel('other');const latest=h.ctx.loadLevel('test');
 h.requests[2]([{id:'test',name:'Latest'}]);await latest;
 h.requests[0]([{id:'test',name:'Old'}]);h.requests[1]([{id:'other',name:'Other'}]);await Promise.all([first,middle]);
 assert.equal(h.loads.length,1);assert.match(h.loads[0].title,/Latest/);assert.equal(h.nav[0],'navLevel_test');
});
test('cached Level preserves accepted local loader options',async()=>{
 const h=setup({id:'test',name:'Test Level'});await h.ctx.loadLevel('test');
 assert.equal(h.requests.length,0);assert.equal(h.loads[0].sync,false);assert.match(h.loads[0].url,/levelId=test/);assert.match(h.loads[0].title,/Test Level/);
});
test('metadata read without named Level retains fallback title',async()=>{
 const h=setup();const p=h.ctx.loadLevel('missing');h.requests[0]([]);await p;
 assert.equal(h.loads.length,1);assert.match(h.loads[0].title,/Level/);
});
