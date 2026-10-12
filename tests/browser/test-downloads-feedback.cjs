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
  const elements = new Map(['downloadsManager','dlList','dlListHeading','dlSearchInput'].map(id=>[id,node()]));
  const window = {electronAPI: get ? {downloadsGet:get} : null};
  const document = {getElementById:id=>elements.get(id),querySelectorAll:()=>[],createElement:node,addEventListener() {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../apps/browser/Downloads.js'),'utf8'),{window,document,console:{warn() {}},alert() {},confirm:()=>false});
  return {downloads:window.Downloads,elements,window};
}
function message(h) {return h.elements.get('dlList').children[0].textContent;}
test('Downloads opens immediately with loading feedback before read completes',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));
  const pending=h.downloads.openManager();
  assert.equal(h.elements.get('downloadsManager').classList.contains('open'),true);
  assert.equal(message(h),'Loading downloads...');
  resolve({success:true,data:{items:[]}});await pending;
  assert.equal(message(h),'No downloads in this view.');
  assert.equal(h.elements.get('dlListHeading').textContent,'Downloads (0)');
});
test('unsuccessful read shows error rather than an empty list',async()=>{
  const h=setup(async()=>({success:false}));await h.downloads.openManager();
  assert.match(message(h),/^Could not load downloads/);
  assert.equal(h.elements.get('dlListHeading').textContent,'Downloads');
});
test('rejected read is handled and reopening recovers',async()=>{
  let fail=true;const h=setup(async()=>{if(fail)throw Error('read failed');return {success:true,data:{items:[]}};});
  await h.downloads.openManager();assert.match(message(h),/^Could not load downloads/);
  h.downloads.closeManager();fail=false;await h.downloads.openManager();
  assert.equal(message(h),'No downloads in this view.');
});
test('missing bridge gives explicit feedback',async()=>{
  const h=setup();await h.downloads.openManager();assert.match(message(h),/^Could not load downloads/);
});
test('closing during read does not reopen the manager',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));
  const pending=h.downloads.openManager();h.downloads.closeManager();
  resolve({success:true,data:{items:[]}});await pending;
  assert.equal(h.elements.get('downloadsManager').classList.contains('open'),false);
});
test('successful read preserves filters and search rendering',async()=>{
  const h=setup(async()=>({success:true,data:{items:[{id:'1',fileName:'sample.txt',url:'https://example.com/sample',status:'completed',startTime:Date.now(),progress:100}]}}));
  await h.downloads.openManager();assert.equal(h.elements.get('dlListHeading').textContent,'Downloads (1)');
  h.downloads.setFilter('active');assert.equal(message(h),'No downloads in this view.');
  h.downloads.setFilter('completed');assert.equal(h.elements.get('dlListHeading').textContent,'Downloads (1)');
  h.downloads.onSearchInput('absent');assert.equal(message(h),'No downloads match your search.');
});
