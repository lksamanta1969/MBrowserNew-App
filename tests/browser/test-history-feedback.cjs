const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup(get) {
  function node() {
    const classes = new Set();
    return {children: [], textContent: '', attrs: {}, events: {},
      classList: {contains: n => classes.has(n),add: n => classes.add(n),remove: n => classes.delete(n),toggle() {}},
      set innerHTML(v) {this.children=[]; this.html=v;}, get innerHTML() {return this.html;},
      appendChild(n) {this.children.push(n);},setAttribute(n,v) {this.attrs[n]=v;},
      addEventListener(n,f) {this.events[n]=f;},focus() {this.focused=true;}};
  }
  const elements = new Map(['historyManager','histList','histListHeading','histSearchInput','histSelectAll'].map(id=>[id,node()]));
  const window = {electronAPI: get ? {historyGet:get} : null};
  const document = {getElementById:id=>elements.get(id),querySelectorAll:()=>[],createElement:node,addEventListener() {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../apps/browser/History.js'),'utf8'),{window,document,console:{warn() {}},alert() {},confirm:()=>false});
  return {history:window.History,elements,window};
}
function message(h) {return h.elements.get('histList').children[0].textContent;}
test('History opens immediately with loading feedback before read completes',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));
  const pending=h.history.openManager();
  assert.equal(h.elements.get('historyManager').classList.contains('open'),true);
  assert.equal(message(h),'Loading history...');
  resolve({success:true,data:{entries:[]}});await pending;
  assert.equal(message(h),'No browsing history in this range.');
  assert.equal(h.elements.get('histListHeading').textContent,'History (0)');
});
test('unsuccessful read shows error rather than an empty list',async()=>{
  const h=setup(async()=>({success:false}));await h.history.openManager();
  assert.match(message(h),/^Could not load history/);
  assert.equal(h.elements.get('histListHeading').textContent,'History');
});
test('rejected read is handled and reopening recovers',async()=>{
  let fail=true;const h=setup(async()=>{if(fail)throw Error('read failed');return {success:true,data:{entries:[]}};});
  await h.history.openManager();assert.match(message(h),/^Could not load history/);
  h.history.closeManager();fail=false;await h.history.openManager();
  assert.equal(message(h),'No browsing history in this range.');
});
test('missing bridge gives explicit feedback',async()=>{
  const h=setup();await h.history.openManager();assert.match(message(h),/^Could not load history/);
});
test('closing during read does not reopen the manager',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));
  const pending=h.history.openManager();h.history.closeManager();
  resolve({success:true,data:{entries:[]}});await pending;
  assert.equal(h.elements.get('historyManager').classList.contains('open'),false);
});
test('successful read preserves filters and search rendering',async()=>{
  const h=setup(async()=>({success:true,data:{entries:[{id:'1',title:'sample.txt',url:'https://example.com/sample',status:'completed',lastVisited:Date.now(),progress:100}]}}));
  await h.history.openManager();assert.equal(h.elements.get('histListHeading').textContent,'History (1)');
  h.history.setFilter('yesterday');assert.equal(message(h),'No browsing history in this range.');
  h.history.setFilter('all');assert.equal(h.elements.get('histListHeading').textContent,'History (1)');
  h.history.onSearchInput('absent');assert.equal(message(h),'No matching history entries.');
});


test('History Select all disabled during read and after read error',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));
  const pending=h.history.openManager();
  assert.equal(h.elements.get('histSelectAll').disabled,true);
  h.history.toggleSelectAll(true);
  resolve({success:false});await pending;
  assert.equal(h.elements.get('histSelectAll').disabled,true);
  h.window.electronAPI.historyGet=async()=>({success:true,data:{entries:[]}});
  await h.history.openManager();
  assert.equal(h.elements.get('histSelectAll').disabled,false);
});
