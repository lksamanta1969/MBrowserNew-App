const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {getBackendDataPaths}=require('../../server/BackendDataPaths');
test('development keeps existing application data paths',()=>{
 const root=path.resolve('fixture-source');const data=getBackendDataPaths(root,{});
 assert.equal(data.mail,path.join(root,'maildb.json'));assert.equal(data.notes,path.join(root,'mnotes.json'));assert.equal(data.envFile,path.join(root,'.env'));
});
test('configured user data directory is created without copying private app data',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mbrowser-data-test-'));const source=path.join(temp,'app');fs.mkdirSync(source);
 fs.writeFileSync(path.join(source,'maildb.json'),'PRIVATE_FIXTURE');const dest=path.join(temp,'user','backend');
 try{const data=getBackendDataPaths(source,{MBROWSER_DATA_DIR:dest});assert.ok(fs.existsSync(dest));
 for(const key of ['mail','pay','notes','tube','envFile'])assert.equal(path.dirname(data[key]),dest);
 assert.equal(fs.existsSync(data.mail),false);assert.equal(fs.readFileSync(path.join(source,'maildb.json'),'utf8'),'PRIVATE_FIXTURE');
 }finally{const actual=fs.realpathSync(temp);assert.ok(actual.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(actual).startsWith('mbrowser-data-test-'));fs.rmSync(actual,{recursive:true,force:true});}
});
test('relative data override is rejected',()=>{assert.throws(()=>getBackendDataPaths('/app',{MBROWSER_DATA_DIR:'relative'}),/absolute path/);});
