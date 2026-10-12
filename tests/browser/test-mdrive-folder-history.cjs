const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function setup(initial=[],hash=''){
 const html=fs.readFileSync(path.join(__dirname,'../../apps/mdrive/index.html'),'utf8');
 const start=html.indexOf('function writeFolderHistory(');const end=html.indexOf('function handleFolderClick(',start);
 const entries=[],events={},refreshes=[];
 const window={location:{href:'http://localhost:3000/apps/mdrive/index.html?v=123'+hash,hash},
 history:{state:null,replaceState(s,_t,url){this.state=s;entries[0]={s,url};},pushState(s,_t,url){this.state=s;entries.push({s,url});}},addEventListener:(n,f)=>events[n]=f};
 const ctx=vm.createContext({window,URL,currentPath:initial,folderClickTimer:null,fileClickTimer:null,selectedFolderPath:'old',selectedFilePath:'old',saveUiState(){},refreshCurrentView:o=>refreshes.push(o),clearTimeout});
 vm.runInContext(html.slice(start,end),ctx);ctx.initializeFolderHistory();return {ctx,window,entries,events,refreshes};
}
test('nested folder navigation creates Back/Forward history without reloading',()=>{
 const h=setup();h.ctx.navigateToPath(['Documents']);h.ctx.navigateToPath(['Documents','New Folder']);
 assert.equal(h.entries.length,3);assert.match(h.entries[2].url,/#folder=Documents%2FNew%20Folder/);
 h.events.popstate({state:h.entries[1].s});assert.equal(h.ctx.currentPath.join('/'),'Documents');assert.equal(h.entries.length,3);
 h.events.popstate({state:h.entries[2].s});assert.equal(h.ctx.currentPath.join('/'),'Documents/New Folder');assert.equal(h.entries.length,3);
});
test('same folder does not create duplicate history and clears selection',()=>{
 const h=setup(['Documents']);h.ctx.navigateToPath(['Documents']);assert.equal(h.entries.length,1);assert.equal(h.ctx.selectedFolderPath,null);
});
test('folder URL restores nested path and keeps launch query',()=>{
 const h=setup([], '#folder=Documents%2FNew%20Folder');assert.equal(h.ctx.currentPath.join('/'),'Documents/New Folder');assert.match(h.entries[0].url,/v=123/);
});
test('saved path becomes initial history; breadcrumb root gets its own entry',()=>{
 const h=setup(['Documents']);assert.equal(h.entries[0].s.mdrivePath.join('/'),'Documents');h.ctx.navigateToPath([]);assert.equal(h.entries.length,2);assert.equal(h.ctx.currentPath.length,0);
});
