const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup() {
 const root=process.env.MBROWSER_TEST_SOURCE || path.join(__dirname,'../../apps/browser');
 const elements=new Map();
 const element=id=>{if(!elements.has(id)) {const classes=new Set();elements.set(id,{style:{display:'none'},classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},querySelectorAll:()=>[],disabled:true,hidden:false,innerHTML:'',textContent:''});}return elements.get(id);};
 const document=new EventTarget();document.getElementById=element;
 const window={onHomePage:false};
 const retrievals=[];let delay=false;
 window.electronAPI={
  settingsGet:async()=>({success:true,data:{privacy:{}}}),neverSaveGet:async()=>({success:true,data:{origins:[]}}),
  passwordsMatch:async()=>({success:true,data:{matches:[{id:'fake',username:'test'}]}}),
  passwordsRetrieveForFill:async()=>delay?new Promise(resolve=>retrievals.push(resolve)):({success:true,data:{username:'test',password:'fixture-only'}}),
  passwordsAdd:async()=>({success:true}),passwordsUpdate:async()=>({success:true}),vaultStatus:async()=>({success:true,data:{migrationState:'complete',unlocked:true}})
 };
 const ctx=vm.createContext({window,document,console,URL,AbortController,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(root,'BrowserTab.js'),'utf8'),ctx);
 ctx.createTabService=window.createTabService;
 vm.runInContext(fs.readFileSync(path.join(root,'Autofill.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'LoginDetection.js'),'utf8'),ctx);
 class View extends EventTarget {
  constructor(){super();this.url='https://fixture.example/login';this.isConnected=true;this.style={display:'flex'};this.fills=0;}
  getURL(){return this.url;}
  async executeJavaScript(source){if(source.includes('applyFill(')){this.fills++;return {ok:true};}return null;}
 }
 const a=new View(),b=new View();elements.set('browser',a);
 return {window,a,b,element,retrievals,setDelay:v=>delay=v};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
const credential={success:true,data:{username:'test',password:'fixture-only'}};

test('credential retrieval cannot cross tabs, closed tabs, or navigation; active fill still works',async()=>{
 const h=setup(), af=h.window.Autofill;
 await af.init();
 const offer=()=>af.showOfferPrompt([{id:'fake',username:'test'}],'https://fixture.example','https://fixture.example/login');
 h.setDelay(true);offer();const pending=af.fillSelected();
 while(!h.retrievals.length)await tick();
 af.deactivate();await af.activate(h.b);
 assert.equal(h.element('afOfferPrompt').classList.contains('open'),false);
 h.retrievals.shift()(credential);await pending;
 assert.equal(h.a.fills,0);assert.equal(h.b.fills,0);
 h.setDelay(false);offer();await af.fillSelected();assert.equal(h.b.fills,1);
 h.setDelay(true);offer();const navigating=af.fillSelected();while(!h.retrievals.length)await tick();
 h.b.url='https://other.example/';h.retrievals.shift()(credential);await navigating;assert.equal(h.b.fills,1);
 h.b.url='https://fixture.example/login';offer();const closing=af.fillSelected();while(!h.retrievals.length)await tick();
 af.dispose(h.b);h.b.isConnected=false;h.retrievals.shift()(credential);await closing;assert.equal(h.b.fills,1);
 af.dispose(h.a);
});

test('background guest events cannot open credential offers on the active tab',async()=>{
 const h=setup(), af=h.window.Autofill;
 await af.init();af.deactivate();await af.activate(h.b);
 const event=new Event('ipc-message');event.channel='af:form-detected';event.args=[{hasLoginForm:true,url:h.a.url,origin:'https://fixture.example',fields:[]}];h.a.dispatchEvent(event);
 await tick();assert.equal(h.element('afOfferPrompt').classList.contains('open'),false);
 af.dispose(h.a);af.dispose(h.b);
});

test('login-save prompts remain owned by the originating active tab',async()=>{
 const h=setup(),ld=h.window.LoginDetection;
 await ld.init();
 const event=new Event('ipc-message');event.channel='ld:pending';event.args=[{username:'test',password:'fixture-only',url:h.a.url,origin:'https://fixture.example',submittedAt:Date.now()}];
 h.a.dispatchEvent(event);ld.deactivate();await ld.activate(h.b);
 await new Promise(r=>setTimeout(r,800));assert.equal(h.element('ldSavePrompt').classList.contains('open'),false);
 ld.dispose(h.a);ld.dispose(h.b);
});
