const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createBackendProcess}=require('../../server/BackendProcess');
function setup(){const children=[],calls=[],errors=[];const backend=createBackendProcess({executable:'electron.exe',script:'server.js',cwd:'test-root',env:{PATH:'fixture'},onError:e=>errors.push(e),spawnProcess:(...args)=>{calls.push(args);const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kills=0;child.kill=()=>{child.kills++;return true;};children.push(child);return child;}});return {backend,children,calls,errors};}
test('backend uses bundled executable directly in Node mode with hidden window',()=>{
 const h=setup();h.backend.start();assert.equal(h.calls[0][0],'electron.exe');assert.equal(h.calls[0][2].shell,false);
 assert.equal(h.calls[0][2].windowsHide,true);assert.equal(h.calls[0][2].env.ELECTRON_RUN_AS_NODE,'1');assert.equal(h.calls[0][2].env.PATH,'fixture');
});
test('start does not create duplicate child and stop kills only owned child once',()=>{
 const h=setup();const child=h.backend.start();assert.equal(h.backend.start(),child);assert.equal(h.children.length,1);
 h.backend.stop();h.backend.stop();assert.equal(child.kills,1);
});
test('exited child is not killed and a later start creates a fresh child',()=>{
 const h=setup();const child=h.backend.start();child.exitCode=0;child.emit('exit',0);h.backend.stop();assert.equal(child.kills,0);
 h.backend.start();assert.equal(h.children.length,2);
});
test('spawn errors are handled and do not retain failed child',()=>{
 const h=setup();const child=h.backend.start();const error=Error('spawn failed');child.emit('error',error);
 assert.equal(h.errors[0],error);h.backend.stop();assert.equal(child.kills,0);
});
test('old exit event cannot clear a newly started child',()=>{
 const h=setup();const old=h.backend.start();h.backend.stop();const current=h.backend.start();old.emit('exit',0);h.backend.stop();assert.equal(current.kills,1);
});


test('backend start passes explicit data folder without changing Node mode',()=>{
 const h=setup();h.backend.start({MBROWSER_DATA_DIR:'user-data',ELECTRON_RUN_AS_NODE:'0'});
 assert.equal(h.calls[0][2].env.MBROWSER_DATA_DIR,'user-data');assert.equal(h.calls[0][2].env.ELECTRON_RUN_AS_NODE,'1');
});
