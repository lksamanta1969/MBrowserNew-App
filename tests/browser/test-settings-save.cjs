const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
async function setup(set) {
  const store={general:{browserName:'MBrowser',defaultZoom:100},appearance:{theme:'light',showBookmarksBar:false}};
  const alerts=[];const zooms=[];
  const elements=new Map([
    ['settingsManager',{classList:{contains:()=>false}}],
    ['browser',{setZoomFactor:z=>zooms.push(z)}],
    ['url',{}],['homesearch',{}],['bookmarksBar',{style:{}}]
  ]);
  const homeTitle={textContent:''};
  const document={title:'',body:{setAttribute(){},classList:{toggle(){}}},documentElement:{style:{setProperty(){}}},
    getElementById:id=>elements.get(id),querySelector:()=>homeTitle};
  const window={electronAPI:{settingsGet:async()=>({success:true,data:store}),settingsSet:set}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../apps/browser/Settings.js'),'utf8'),{window,document,console:{warn(){}},alert:m=>alerts.push(m)});
  await window.Settings.reloadAndApply();
  zooms.length=0;
  return {settings:window.Settings,window,document,alerts,zooms};
}
test('rejected settings save is handled and keeps last saved values',async()=>{
  const h=await setup(async()=>{throw Error('unavailable');});
  const result=await h.settings.savePatch({general:{defaultZoom:110}});
  assert.equal(result,null);assert.equal(h.settings.get('general.defaultZoom'),100);
  assert.equal(h.zooms.length,0);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/Could not save settings/);
});
test('unsuccessful save reports server error and does not apply rejected values',async()=>{
  const h=await setup(async()=>({success:false,error:'Save failed'}));
  await h.settings.savePatch({general:{browserName:'Changed'}});
  assert.equal(h.settings.get('general.browserName'),'MBrowser');assert.equal(h.document.title,'MBrowser');
  assert.equal(h.alerts[0],'Save failed');
});
test('save without API reports failure rather than silently succeeding',async()=>{
  const h=await setup(async()=>({success:false}));h.window.electronAPI=null;
  assert.equal(await h.settings.savePatch({}),null);assert.equal(h.alerts.length,1);
});
test('successful save still applies returned values and runtime effects',async()=>{
  const h=await setup(async()=>({success:true,data:{general:{browserName:'MBrowser',defaultZoom:110},appearance:{theme:'light',showBookmarksBar:false}}}));
  const result=await h.settings.savePatch({general:{defaultZoom:110}});
  assert.equal(result.general.defaultZoom,110);assert.equal(h.settings.get('general.defaultZoom'),110);
  assert.equal(h.zooms[0],1.1);assert.equal(h.alerts.length,0);
});
test('failed save can recover on the next attempt',async()=>{
  let fail=true;const h=await setup(async()=>{if(fail)throw Error('offline');return {success:true,data:{general:{defaultZoom:100}}};});
  await h.settings.savePatch({general:{defaultZoom:110}});fail=false;
  const result=await h.settings.savePatch({general:{defaultZoom:100}});
  assert.equal(result.general.defaultZoom,100);assert.equal(h.alerts.length,1);assert.equal(h.zooms[0],1);
});
