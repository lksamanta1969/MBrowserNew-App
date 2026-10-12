const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function setup(get,about) {
  function node(){const classes=new Set();return {children:[],textContent:'',
    classList:{contains:n=>classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n)},
    set innerHTML(v){this.children=[];this.html=v;},get innerHTML(){return this.html;},
    appendChild(n){this.children.push(n);},setAttribute(){},addEventListener(){},focus(){}};}
  const elements=new Map(['settingsManager','settingsContent','settingsSectionTitle','settingsSearchInput','settingsNav'].map(id=>[id,node()]));
  let writes=0;const alerts=[];
  const window={electronAPI:{settingsGet:get,settingsGetAbout:about,settingsSet:async()=>{writes++;return {success:true};}}};
  const document={getElementById:id=>elements.get(id),createElement:node};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../apps/browser/Settings.js'),'utf8'),{window,document,console:{warn(){}},alert:m=>alerts.push(m)});
  return {settings:window.Settings,window,elements,alerts,writes:()=>writes};
}
const ok=()=>({success:true,data:{general:{defaultZoom:100}}});
function message(h){return h.elements.get('settingsContent').children[0]?.textContent;}
test('Settings opens with loading feedback and renders after read',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));const pending=h.settings.openManager();
  assert.equal(message(h),'Loading settings...');resolve(ok());await pending;
  assert.match(h.elements.get('settingsContent').innerHTML,/Default zoom/);
});
test('failed Settings read shows feedback without editable fallback controls',async()=>{
  const h=setup(async()=>({success:false}));await h.settings.openManager();
  assert.match(message(h),/^Could not load settings/);
  await h.settings.savePatch({general:{defaultZoom:110}});assert.equal(h.writes(),0);
});
test('rejected read recovers on close and reopen',async()=>{
  let fail=true;const h=setup(async()=>{if(fail)throw Error('read failed');return ok();});
  await h.settings.openManager();assert.match(message(h),/^Could not load settings/);
  h.settings.closeManager();fail=false;await h.settings.openManager();
  assert.equal(h.settings.get('general.defaultZoom'),100);
  assert.match(h.elements.get('settingsContent').innerHTML,/Default zoom/);
});
test('About lookup failure does not block General settings',async()=>{
  const h=setup(async()=>ok(),async()=>{throw Error('about unavailable');});await h.settings.openManager();
  assert.match(h.elements.get('settingsContent').innerHTML,/Default zoom/);
});
test('closing during read keeps Settings closed',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));const pending=h.settings.openManager();
  h.settings.closeManager();resolve(ok());await pending;
  assert.equal(h.elements.get('settingsManager').classList.contains('open'),false);
});
test('missing API shows Settings read feedback',async()=>{
  const h=setup(async()=>ok());h.window.electronAPI=null;await h.settings.openManager();
  assert.match(message(h),/^Could not load settings/);
});
